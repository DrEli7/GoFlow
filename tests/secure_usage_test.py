"""No real auth store, vault or network. Temporary randomized fixture only."""
import importlib.util, pathlib, unittest, json, os, tempfile, secrets, io, urllib.error, socket
from unittest.mock import patch
source=pathlib.Path(__file__).resolve().parents[1]/'scripts/secure_usage.py'
spec=importlib.util.spec_from_file_location('secure_usage',source)
secure=importlib.util.module_from_spec(spec);spec.loader.exec_module(secure)

class Response:
    status=200
    headers={'Date':'Tue, 13 Oct 2026 05:14:44 GMT'}
    def __init__(self,body):self.body=body
    def __enter__(self):return self
    def __exit__(self,*a):pass
    def read(self,*a):return json.dumps(self.body).encode()

class SecureBoundary(unittest.TestCase):
    def setUp(self):
        self.fixture=secrets.token_urlsafe(40)
        self.auth={'available':True,'source':'SIMULATED'}
        self.body={'usage':{k:{'status':'ok','percent':0,'resetsAt':'2026-11-01T00:00:00.000Z'} for k in ('rolling','weekly','monthly')}}
    def query(self,opener):
        with patch.object(secure,'credential',return_value=(self.fixture,self.auth)),patch.object(secure.urllib.request,'build_opener',return_value=opener):return secure.query()
    def test_success_never_emits_or_persists_key(self):
        key=self.fixture
        class Opener:
            def open(self,request,timeout):
                assert request.full_url==secure.ENDPOINT
                assert request.get_method()=='GET'
                assert request.get_header('Authorization')=='Bearer '+key
                return Response({**self_body,'apiKey':key,'secret':key,'cookie':key,'message':key})
        self_body=self.body
        result=self.query(Opener())
        self.assertTrue(result['ok']);self.assertEqual(result['httpStatus'],200)
        self.assertNotIn(key,json.dumps(result));self.assertEqual(result['body'],self.body)
    def test_missing_key_gives_local_guidance_and_never_network(self):
        with patch.object(secure,'credential',return_value=(None,{'available':False,'source':'SIMULATED'})),patch.object(secure.urllib.request,'build_opener') as mock:
            result=secure.query();mock.assert_not_called()
        self.assertEqual(result['category'],'authorization');self.assertIn('local terminal',result['guidance']);self.assertIn('Never paste',result['guidance'])
    def test_401_429_and_server_errors_have_no_response_body_leak(self):
        for code,category in ((401,'authorization'),(403,'authorization'),(429,'quota'),(500,'service'),(503,'service'),(302,'service')):
            key=self.fixture
            class Opener:
                def open(self,*a,**k):raise urllib.error.HTTPError(secure.ENDPOINT,code,key,{'Retry-After':'60'},io.BytesIO(key.encode()))
            result=self.query(Opener());self.assertEqual(result['category'],category);self.assertEqual(result['httpStatus'],code);self.assertNotIn(key,json.dumps(result));self.assertTrue(result['consoleFallback'])
    def test_timeout_and_network_errors_are_generic(self):
        for failure in (socket.timeout(self.fixture),urllib.error.URLError(self.fixture),OSError(self.fixture)):
            class Opener:
                def open(self,*a,**k):raise failure
            result=self.query(Opener());self.assertEqual(result['category'],'network');self.assertNotIn(self.fixture,json.dumps(result))
    def test_redirect_handler_never_forwards_bearer(self):
        self.assertIsNone(secure.NoRedirect().redirect_request(None,None,302,'redirect',{},'https://example.invalid'))
    def test_only_go_provider_is_selected_from_isolated_store(self):
        with tempfile.TemporaryDirectory(prefix='goflow-fake-auth-') as directory:
            location=pathlib.Path(directory)/'opencode/auth.json';location.parent.mkdir()
            location.write_text(json.dumps({'opencode-go':{'type':'api','key':self.fixture},'other':{'type':'api','key':secrets.token_urlsafe(40)}}))
            with patch.dict(os.environ,{'XDG_DATA_HOME':directory}):
                value,meta=secure.credential();self.assertEqual(value,self.fixture);self.assertTrue(meta['available']);self.assertNotIn(self.fixture,json.dumps(meta))
    def test_malformed_auth_store_is_safe(self):
        with tempfile.TemporaryDirectory(prefix='goflow-fake-auth-') as directory:
            location=pathlib.Path(directory)/'opencode/auth.json';location.parent.mkdir();location.write_text('[]')
            with patch.dict(os.environ,{'XDG_DATA_HOME':directory}):
                value,meta=secure.credential();self.assertIsNone(value);self.assertFalse(meta['available'])
    def test_secret_field_filter_and_no_injected_headers(self):
        self.assertIsNone(secure.safe_payload('unrecognized secret','message'))
        self.assertFalse(secure.valid_secret(self.fixture+'\r\nAuthorization: other'))
        self.assertIsNone(secure.safe_payload(float('nan'),'percent'))
    def test_vault_write_requires_real_local_tty(self):
        with patch.object(secure.sys.stdin,'isatty',return_value=False):
            result=secure.vault_write()
        if os.name=='nt':self.assertEqual(result['category'],'interactive_terminal_required')
    def test_nested_unknown_limits_and_untyped_billing_are_not_verified(self):
        self.assertFalse(secure.schema_extras(self.body))
        altered=json.loads(json.dumps(self.body));altered['usage']['modelLimits']={}
        self.assertTrue(secure.schema_extras(altered))
        altered=json.loads(json.dumps(self.body));altered['usage']['rolling']['remaining']=100
        self.assertTrue(secure.schema_extras(altered))
        self.assertTrue(secure.schema_extras({**self.body,'useBalance':'false'}))
    def test_missing_store_uses_safe_local_flow(self):
        with tempfile.TemporaryDirectory(prefix='goflow-fake-auth-') as directory:
            self.assertEqual(pathlib.Path(directory).resolve().parent,pathlib.Path(tempfile.gettempdir()).resolve())
            with patch.dict(os.environ,{'XDG_DATA_HOME':directory}),patch.object(secure.urllib.request,'build_opener') as network:
                result=secure.query();network.assert_not_called()
        self.assertEqual(result['category'],'authorization');self.assertIn('opencode auth login',result['guidance'])

if __name__=='__main__':unittest.main(verbosity=2)
