"""Private local credential boundary. Emits quota metadata only, never credentials."""
from pathlib import Path
import os, sys, json, re, math, hashlib, hmac, datetime, email.utils, urllib.request, urllib.error, socket, ssl, getpass

ENDPOINT='https://opencode.ai/zen/go/v1/usage'
VAULT_TARGET='GoFlow/OpenCodeGo'
MAX_BODY=262144
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')

def vault_read():
    if os.name!='nt': return None
    import ctypes
    from ctypes import wintypes
    class Credential(ctypes.Structure):
        _fields_=[('Flags',wintypes.DWORD),('Type',wintypes.DWORD),('TargetName',wintypes.LPWSTR),('Comment',wintypes.LPWSTR),('LastWritten',wintypes.FILETIME),('CredentialBlobSize',wintypes.DWORD),('CredentialBlob',ctypes.POINTER(ctypes.c_ubyte)),('Persist',wintypes.DWORD),('AttributeCount',wintypes.DWORD),('Attributes',ctypes.c_void_p),('TargetAlias',wintypes.LPWSTR),('UserName',wintypes.LPWSTR)]
    dll=ctypes.WinDLL('Advapi32.dll',use_last_error=True)
    pointer=ctypes.POINTER(Credential)()
    dll.CredReadW.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,ctypes.POINTER(ctypes.POINTER(Credential))]
    dll.CredReadW.restype=wintypes.BOOL
    dll.CredFree.argtypes=[ctypes.c_void_p]
    if not dll.CredReadW(VAULT_TARGET,1,0,ctypes.byref(pointer)): return None
    try:
        size=pointer.contents.CredentialBlobSize
        if not 0<size<=2560:return None
        return ctypes.string_at(pointer.contents.CredentialBlob,size).decode('utf-8')
    finally:dll.CredFree(pointer)

def vault_write():
    if os.name!='nt': return {'ok':False,'category':'unsupported_platform'}
    if not sys.stdin.isatty(): return {'ok':False,'category':'interactive_terminal_required','guidance':'Run this helper in a local terminal. Do not paste a key in chat.'}
    secret=getpass.getpass('OpenCode Go API key (hidden, stored in Windows Credential Manager): ')
    if not valid_secret(secret): return {'ok':False,'category':'invalid_local_input'}
    import ctypes
    from ctypes import wintypes
    class Credential(ctypes.Structure):
        _fields_=[('Flags',wintypes.DWORD),('Type',wintypes.DWORD),('TargetName',wintypes.LPWSTR),('Comment',wintypes.LPWSTR),('LastWritten',wintypes.FILETIME),('CredentialBlobSize',wintypes.DWORD),('CredentialBlob',ctypes.POINTER(ctypes.c_ubyte)),('Persist',wintypes.DWORD),('AttributeCount',wintypes.DWORD),('Attributes',ctypes.c_void_p),('TargetAlias',wintypes.LPWSTR),('UserName',wintypes.LPWSTR)]
    encoded=bytearray(secret.encode('utf-8'))
    array=(ctypes.c_ubyte*len(encoded)).from_buffer(encoded)
    try:
        record=Credential(Type=1,TargetName=VAULT_TARGET,Comment='GoFlow OpenCode Go usage query only',CredentialBlobSize=len(encoded),CredentialBlob=array,Persist=2,UserName='OpenCodeGo')
        dll=ctypes.WinDLL('Advapi32.dll',use_last_error=True)
        dll.CredWriteW.argtypes=[ctypes.POINTER(Credential),wintypes.DWORD];dll.CredWriteW.restype=wintypes.BOOL
        ok=bool(dll.CredWriteW(ctypes.byref(record),0))
    except Exception:ok=False
    finally:
        for i in range(len(encoded)):encoded[i]=0
        secret=None
    return {'ok':ok,'category':'ok' if ok else 'vault_write_failed','storage':'Windows Credential Manager','target':VAULT_TARGET}

def valid_secret(secret):return isinstance(secret,str) and 8<=len(secret.encode('utf-8'))<=2560 and not re.search(r'[\s\x00-\x1f\x7f]',secret)
def credential(source='opencode'):
    if source=='windows-vault':
        try:secret=vault_read()
        except Exception:secret=None
        native,native_meta=credential('opencode')
        same=valid_secret(secret) and valid_secret(native) and hmac.compare_digest(secret.encode(),native.encode())
        native=None
        return (secret,{'available':valid_secret(secret),'source':'windows_credential_manager','inferenceCredentialMatches':bool(same),'bindingId':hashlib.sha256(secret.encode()).hexdigest() if valid_secret(secret) else None})
    # Only select the Go provider. Do not access ChatGPT auth or browser storage.
    data_root=Path(os.environ.get('XDG_DATA_HOME',str(Path.home()/'.local/share')))
    auth_file=data_root/'opencode/auth.json'
    try:
        if auth_file.is_symlink() or auth_file.stat().st_size>1048576:return None,{'available':False,'source':'existing_opencode_auth','reason':'unsupported_auth_store'}
        with auth_file.open('r',encoding='utf-8') as handle:data=json.load(handle)
        item=data.get('opencode-go',{})
        secret=item.get('key') if item.get('type')=='api' else None
        data=None;item=None
        return secret,{'available':valid_secret(secret),'source':'existing_opencode_auth','inferenceCredentialMatches':valid_secret(secret),'bindingId':hashlib.sha256(secret.encode()).hexdigest() if valid_secret(secret) else None}
    except (OSError,ValueError,TypeError,AttributeError):return None,{'available':False,'source':'existing_opencode_auth'}

SAFE_FIELDS={'usage','rolling','weekly','monthly','rollingUsage','weeklyUsage','monthlyUsage','useBalance','status','percent','usagePercent','resetsAt','resetAt','resetInSec'}
SAFE_STATUS={'ok','allowed','rate-limited','limited','exhausted','unknown'}
def safe_payload(value,key='',depth=0):
    if depth>8:return None
    if isinstance(value,bool) or value is None:return value
    if isinstance(value,(int,float)) and not isinstance(value,bool):
        return value if math.isfinite(value) and abs(value)<=10**16 else None
    if isinstance(value,str):
        if key=='status' and value in SAFE_STATUS:return value
        if key in ('resetsAt','resetAt') and re.fullmatch(r'\d{4}-\d\d-\d\d[T ][0-9:.+-]+Z?',value):return value
        return None
    if isinstance(value,list):return [safe_payload(v,key,depth+1) for v in value[:200]]
    if isinstance(value,dict):
        result={}
        for name,item in list(value.items())[:200]:
            if name in SAFE_FIELDS:
                result[name]=safe_payload(item,name,depth+1)
        return result
    return None

def schema_extras(body):
    if any(k not in ('usage','useBalance','rollingUsage','weeklyUsage','monthlyUsage') for k in body):return True
    if 'useBalance' in body and not isinstance(body['useBalance'],bool):return True
    if 'usage' in body:
        usage=body['usage']
        if not isinstance(usage,dict) or set(usage)!=set(('rolling','weekly','monthly')):return True
        return any(not isinstance(item,dict) or set(item)!=set(('status','percent','resetsAt')) for item in usage.values())
    legacy=[body.get(k+'Usage') for k in ('rolling','weekly','monthly')]
    return any(not isinstance(item,dict) or set(item)!=set(('status','usagePercent','resetInSec')) for item in legacy)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def query(source='opencode',timeout=12):
    fetched=now();secret,auth=credential(source)
    result={'ok':False,'endpoint':ENDPOINT,'fetchedAt':fetched,'auth':auth,'httpStatus':None,'consoleFallback':True,'category':'authorization'}
    if not auth['available']:
        result['guidance']='Use opencode auth login in a local terminal, select OpenCode Go. Never paste a key in chat. Optional local Windows vault setup is available.'
        return result
    if auth.get('inferenceCredentialMatches') is False:
        result['reason']='credential_mismatch';return result
    try:
        request=urllib.request.Request(ENDPOINT,headers={'Authorization':'Bearer '+secret,'Accept':'application/json','User-Agent':'GoFlow/1.1.0'},method='GET')
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
        with opener.open(request,timeout=timeout) as response:
            result['httpStatus']=response.status
            data=response.read(MAX_BODY+1)
            if len(data)>MAX_BODY:result['category']='schema';return result
            try:body=json.loads(data)
            except (ValueError,UnicodeError):result['category']='schema';return result
            if not isinstance(body,dict):result['category']='schema';return result
            try:server_date=email.utils.parsedate_to_datetime(response.headers.get('Date','')).isoformat()
            except (TypeError,ValueError,OverflowError):server_date=None
            result.update(ok=True,category='ok',consoleFallback=False,body=safe_payload(body),responseFields=sorted(k for k in body if k in SAFE_FIELDS),serverDate=server_date,
                          schemaExtrasPresent=schema_extras(body))
            # A server echo or malformed header must not make the credential leave RAM.
            if secret in json.dumps(result):
                return {'ok':False,'category':'schema','endpoint':ENDPOINT,'fetchedAt':fetched,'auth':{'available':True,'source':auth['source']},'httpStatus':response.status,'consoleFallback':True,'reason':'unsafe_response_rejected'}
            return result
    except urllib.error.HTTPError as error:
        result['httpStatus']=error.code
        result['category']='authorization' if error.code in (401,403) else 'quota' if error.code==429 else 'service'
        value=error.headers.get('Retry-After','')
        if re.fullmatch(r'\d{1,8}',value):result['retryAfterSeconds']=min(int(value),86400)
        # Deliberately do not read/store error body or authentication headers.
        return result
    except (TimeoutError,socket.timeout,urllib.error.URLError,OSError):
        result['category']='network';return result
    finally:
        secret=None

def scan_goflow_outputs():
    """User-requested leak acceptance: compare privately, disclose no key/hash."""
    secret,auth=credential('opencode')
    if not auth['available']:return {'ok':False,'category':'authorization','scanPerformed':False}
    needle=secret.encode('utf-8');secret=None
    roots=list(dict.fromkeys([Path(__file__).resolve().parents[1],Path.home()/'.codex/goflow']))
    scanned=0;matches=[]
    for root in roots:
        for file in root.rglob('*'):
            if not file.is_file() or file.is_symlink() or '.git' in file.parts or 'node_modules' in file.parts:continue
            # These owned directories never include the actual auth store.
            try:
                with file.open('rb') as handle:
                    tail=b'';found=False
                    while True:
                        data=handle.read(1048576)
                        if not data:break
                        joined=tail+data
                        if needle in joined:found=True;break
                        tail=joined[-len(needle):]
                scanned+=1
                if found:matches.append(str(file.relative_to(root)).replace(needle.decode('utf-8'),'[REDACTED]'))
            except OSError:continue
    needle=None
    return {'ok':not matches,'scanPerformed':True,'filesScanned':scanned,'plaintextCredentialFound':bool(matches),'matchFiles':matches,
            'excluded':'Original OpenCode credential store, ChatGPT auth and browser stores; no credential values returned.'}

if __name__=='__main__':
    action=sys.argv[1] if len(sys.argv)>1 else 'query'
    source=sys.argv[2] if len(sys.argv)>2 else 'opencode'
    if source not in ('opencode','windows-vault'):source='opencode'
    if action=='query':output=query(source)
    elif action=='auth-status':
        secret,meta=credential(source);secret=None;output={'ok':meta['available'] and meta.get('inferenceCredentialMatches',True),'auth':meta}
    elif action=='vault-set':output=vault_write()
    elif action=='scan-output':output=scan_goflow_outputs()
    else:output={'ok':False,'category':'unknown_operation'}
    print(json.dumps(output,ensure_ascii=False,allow_nan=False))
