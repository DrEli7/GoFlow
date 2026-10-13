"""Security review: fake credentials and fake HTTP only; no user auth/vault/network."""
import importlib.util, json
from pathlib import Path
helper_path=Path(__file__).resolve().parents[1]/'scripts'/'secure_usage.py'
spec=importlib.util.spec_from_file_location('goflow_security_review_helper',helper_path)
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
original_credential=helper.credential
fake='FAKE_opaque_review_secret_1234567890'
fixture={'usage':{name:{'status':'ok','percent':0,'resetsAt':'2026-11-01T00:00:00.000Z'} for name in ('rolling','weekly','monthly')}}
results=[]
for label,payload in [('model_echo',{'modelID':fake}),('group_name_echo',{'groups':{fake:{'used':1}}})]:
    out=helper.safe_payload(payload)
    results.append({'case':label,'fakeSecretEscapedFilter':fake in json.dumps(out)})
class Response:
    status=200
    headers={'Date':fake}
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def read(self,size):return json.dumps(fixture).encode('utf-8')
class Opener:
    def open(self,request,timeout):return Response()
helper.credential=lambda source:(fake,{'available':True,'source':'fake-test-only','inferenceCredentialMatches':True,'bindingId':'a'*64})
helper.urllib.request.build_opener=lambda *args:Opener()
out=helper.query()
results.append({'case':'date_header_echo','fakeSecretEscapedFilter':fake in json.dumps(out)})
results.append({'case':'blob_byte_limit','unicodeChars':2560,'encodedBytes':len(('测'*2560).encode('utf-8')),'passesInputValidation':helper.valid_secret('测'*2560)})
fake_native='FAKE_NATIVE_review_only_1234567890'
helper.vault_read=lambda:fake_native
helper.credential=lambda source:((fake_native,{'available':True,'source':'fake-native-only'}) if source=='opencode' else original_credential(source))
_,same_meta=original_credential('windows-vault')
helper.vault_read=lambda:'FAKE_OTHER_review_only_1234567890'
_,different_meta=original_credential('windows-vault')
opened=[]
class ForbiddenOpener:
    def open(self,*args,**kwargs):opened.append(True);raise AssertionError('fake mismatch must not open HTTP')
helper.urllib.request.build_opener=lambda *args:ForbiddenOpener()
mismatch=helper.query('windows-vault')
results.append({'case':'credential_binding','sameKeyMatches':same_meta.get('inferenceCredentialMatches'),'differentKeyMatches':different_meta.get('inferenceCredentialMatches'),'mismatchPreventedHttp':not opened and mismatch.get('reason')=='credential_mismatch'})
print(json.dumps({'fakeOnly':True,'noRealAuthOrRequests':True,'results':results},ensure_ascii=False))

