# EWS 凭据独立验证脚本
# 用法（Worker 上）:
#   C:\RPA-Agent\.venv\Scripts\python.exe C:\RPA-Agent\flows\RPA01_07\05_DataJobFile\test_ews.py
import base64
import os
import sys

import pandas as pd
from exchangelib import Credentials, Configuration, Account, DELEGATE

# 读取和 config() 相同的配置文件（相对本文件定位，本地/Worker 都能跑）
BASE = os.path.dirname(os.path.abspath(__file__))
XLSX = os.path.join(BASE, "..", "01_Conf", "Config_download.xlsx")

df = pd.read_excel(XLSX, sheet_name="Variable", header=None, usecols=[0, 1])
cfg = {row[0]: row[1] for row in df.values}

pwd = base64.b64decode(cfg["Password"]).decode()
user = cfg["Email_name"]
server = cfg["Email_server"]
print("User    :", user)
print("Server  :", server)
print("Password:", pwd)

# Test DOMAIN\user login format with:  python test_ews.py ntlm
if len(sys.argv) > 1 and sys.argv[1] == "ntlm":
    login = "LECHLER\\" + user.split("@")[0]
    print("Using NTLM login name:", login)
else:
    login = user

creds = Credentials(username=login, password=pwd)
conf = Configuration(server=server, credentials=creds)
acct = Account(user, config=conf, autodiscover=False, access_type=DELEGATE)
print("AUTH OK! Inbox unread:", acct.inbox.unread_count)
