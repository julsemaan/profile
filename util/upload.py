#!/usr/bin/python

import httplib2
import pprint

from apiclient.discovery import build
from apiclient.http import MediaFileUpload
from oauth2client.client import OAuth2WebServerFlow

from yaml import load, dump
try:
    from yaml import CLoader as Loader, CDumper as Dumper
except ImportError:
    from yaml import Loader, Dumper

def get_config():
    stream = file('util/upload.conf', 'r')
    data = load(stream, Loader=Loader) 
    return data

def sync(drive_file_id, filename):
    # Create an httplib2.Http object and authorize it with our credentials
    http = httplib2.Http()
    http = credentials.authorize(http)

    drive_service = build('drive', 'v2', http=http)

    # Insert a file
    media_body = MediaFileUpload(filename, mimetype='text/plain', resumable=True)

    file = drive_service.files().update(fileId=drive_file_id, media_body=media_body).execute()
    print "Uploaded",filename

config = get_config()

# Copy your credentials from the console
CLIENT_ID = config['drive_api']['id']
CLIENT_SECRET = config['drive_api']['secret']

# Check https://developers.google.com/drive/scopes for all available scopes
OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive'

# Redirect URI for installed apps
REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'

# Run through the OAuth flow and retrieve credentials
flow = OAuth2WebServerFlow(CLIENT_ID, CLIENT_SECRET, OAUTH_SCOPE,
                           redirect_uri=REDIRECT_URI)
authorize_url = flow.step1_get_authorize_url()
print 'Go to the following link in your browser: ' + authorize_url
code = raw_input('Enter verification code: ').strip()
credentials = flow.step2_exchange(code)

sync('0B-k7e2bQSB5_cGRRNUl4Qk96SWs', 'profile/.vimrc')
sync('0B-k7e2bQSB5_WEFqNzR1YlVTaVk', 'profile/.tmux.conf')
sync('0B-k7e2bQSB5_ZzRvZEdrSXJzY0U', 'profile/.bashrc_append')
sync('0B-k7e2bQSB5_OERaSnpGWVNTNzQ', 'profile/setup.sh')



