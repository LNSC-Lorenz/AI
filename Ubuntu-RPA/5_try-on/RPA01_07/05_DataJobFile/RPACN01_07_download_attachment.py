import base64
import logging
import os
import shutil
import traceback
from datetime import datetime, timedelta


import pandas as pd
import pytz
from exchangelib import Credentials, Configuration, Account, DELEGATE, FileAttachment,Message
import os
import sys
from selenium.webdriver.common.keys import Keys
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_OAEP


def load_password():
    # 从文件加载密钥

    def load_private_key():
        if getattr(sys, 'frozen', False):
            # 如果是打包后的exe文件
            bundle_dir = sys._MEIPASS
        else:
            # 如果是源代码运行
            bundle_dir = os.path.dirname(os.path.abspath(__file__))

        private_key_path = os.path.join(bundle_dir, "private.pem")

        if not os.path.exists(private_key_path):
            raise FileNotFoundError(f"私钥文件 {private_key_path} 不存在，请确保私钥文件存在。")

        with open(private_key_path, "rb") as f:
            private_key = f.read()
        return private_key

    # 解密函数
    def decrypt_rsa(encrypted_text, private_key):
        rsa_key = RSA.import_key(private_key)
        cipher = PKCS1_OAEP.new(rsa_key)
        encrypted_bytes = base64.b64decode(encrypted_text)
        decrypted_text = cipher.decrypt(encrypted_bytes).decode()
        return decrypted_text

    # 确保私钥文件存在
    if not os.path.exists("private.pem"):
        raise FileNotFoundError("私钥文件 private.pem 不存在，请确保私钥文件存在。")

    # 加载私钥
    private_key = load_private_key()

    # 示例加密后的密码（假设这是你从其他地方获取的）
    encrypted_password = "ittlyzmt6bL80kZ8yQ5f3p3yG6+N1mrDtrlsY0btG71Kf/A/sfq1KEdimZIkIsZPdRE2KGYgzWh5GaxwmNUjsWpAGldu0pGThCJyVOJAZdDrBgVgtVQnR3pycsALXJ1pPoT0tvzrX0NlNZzs6rpoqHj4GPF6ZksBfgWmAOFl4fCQq6D0TjgRfvQxfRz9u1lveFXqy7EyxPfx0/yac1TG4iIszgS3zawMz7vjehy4eH1Q1+bjYamBN7UsQgDNi+5R3Dyi5et3hAasxhZYyzlYnEkDdNg0f3aqBb4BMK3pQKyLCwEMGlQ79MqjpJ9shGCFDCKeT3jd5/R1pNA7bYmDng=="

    # 解密密码
    decrypted_password = decrypt_rsa(encrypted_password, private_key)
    print(f"Decrypted Password: {decrypted_password}")
    return decrypted_password


def logging_info():
    # 创建一个logger
    global logger
    log_directory =Config['log_directory']  # 替换为你需要的具体路径
    log_filename = f"log_{datetime.now().strftime('%Y-%m-%d')}.log"
    log_file_path = os.path.join(log_directory, log_filename)

    # 确保日志文件所在的目录存在
    os.makedirs(log_directory, exist_ok=True)

    # 创建一个logger
    logger = logging.getLogger('my_logger')
    logger.setLevel(logging.DEBUG)  # 设置全局日志级别

    # 创建一个FileHandler，用于写入日志文件
    file_handler = logging.FileHandler(log_file_path, encoding='utf-8')  # 设置编码为 utf-8
    file_handler.setLevel(logging.DEBUG)  # 设置handler的日志级别

    # 定义handler的输出格式，包括时间戳（精确到秒）
    formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
    file_handler.setFormatter(formatter)

    # 给logger添加handler
    logger.addHandler(file_handler)


def get_base_path():
    """获取基础路径，兼容exe打包和开发环境"""
    if getattr(sys, 'frozen', False):
        # 打包后的exe运行
        return os.path.dirname(sys.executable)
    else:
        # 开发环境运行
        return os.path.dirname(os.path.abspath(__file__))

def get_project_root():
    base_path = get_base_path()
    return os.path.abspath(os.path.join(base_path, '..'))

def ensure_working_dir():
    os.chdir(get_base_path())

def config():
    global Config, base_path

    Config = {}
    # config的相对路径 - 使用脚本所在目录作为基准
    base_path = get_base_path()
    project_root = get_project_root()
    file_path = os.path.join(project_root, '01_Conf', 'Config.xlsx')
    df = pd.read_excel(file_path, sheet_name='Variable', header=None, usecols=[0, 1])
    print(df)
    print(df.values)

    for i in range(len(df.values)):
        print(df.values[i][0])
        print(df.values[i][1])
        Config.update({df.values[i][0]: df.values[i][1]})

    print(Config['Name'])
    decode_str = base64.b64encode(Config['Password'].encode())
    print('这是编译之后的数据' + str(decode_str))
    encode_str = base64.b64decode(Config['Password']).decode()
    # Config['Password']=load_password()
    print('这是编译之后的数据' + str(encode_str))


def send_email(subject, body, to_email, username, password, exchange_server, email_address, attachment_path):
    # 创建Credentials对象
    creds = Credentials(username=username, password=password)

    # 创建Configuration对象
    config = Configuration(server=exchange_server, credentials=creds)

    # 创建Account对象
    account = Account(primary_smtp_address=email_address, config=config, access_type=DELEGATE)

    # 创建Message对象并发送邮件
    subject = subject
    body = body
    recipients = to_email

    attachments = []
    for path in attachment_path:
        with open(path, 'rb') as f:
            attachment = FileAttachment(name=path.split('/')[-1], content=f.read())
            attachments.append(attachment)

    # 创建邮件
    msg = Message(
        account=account,
        subject=subject,
        body=body,
        to_recipients=[r.strip() for r in recipients],
        attachments=attachments
    )
    # 发送邮件
    msg.send()


'''
    root_根目录路径，x 文件名前缀，target_filename 目标文件名，target_file 目标文件路径

'''


def traverse_directories(root_dir, x, target_filename, target_file):
    """
    遍历指定目录下的所有子目录，并打印出它们的路径。

    :param root_dir: 根目录路径
    """
    # 遍历目录树
    for root, dirs, files in os.walk(root_dir, x):
        # 打印当前目录路径
        print("当前目录:", root)

        # 打印当前目录下的所有子目录
        for dir in dirs:
            if dir.startswith(x):
                print("子目录:", os.path.join(root, dir))
                subdir_path = os.path.join(root, dir)
                # 检查子目录下是否有与目标文件同名的文件
                if target_filename not in files:
                    # 移动目标文件到子目录
                    dest_path = os.path.join(subdir_path, target_filename)
                    shutil.move(target_file, dest_path)
                    print(f"已将文件 '{target_filename}' 移动到 '{subdir_path}'")
                    logging.info(f"已将文件 '{target_filename}' 移动到 '{subdir_path}'")


def download_file(password, username, server):
    # 生成文件夹
    now = datetime.now()
    day = now.strftime("%Y-%m-%d")
    year = now.strftime("%Y")
    month = now.strftime("%m")
    year_folder_path = os.path.join(Config['Folder_path'], str(year))
    month_folder_path = os.path.join(year_folder_path, str(month))
    daily_folder_path = os.path.join(month_folder_path, str(day))

    # 创建年文件夹
    if not os.path.exists(year_folder_path):
        os.makedirs(year_folder_path)
        print(f'Create folder:{year_folder_path}')

    # 创建月文件夹
    if not os.path.exists(month_folder_path):
        os.makedirs(month_folder_path)
        print(f'Create folder:{month_folder_path}')

    # 创建日文件夹
    if not os.path.exists(daily_folder_path):
        os.makedirs(daily_folder_path)
        print(f'Create folder:{daily_folder_path}')

    # 清空所有文件
    def clear_folder(folder_path):
        for filename in os.listdir(folder_path):
            file_path = os.path.join(folder_path, filename)
            if os.path.isfile(file_path):
                try:
                    os.remove(file_path)
                    print(f'Delete file:{file_path}')
                except Exception as e:
                    print(f'Failed to delete file:{file_path}, error:{e}')

    clear_folder(daily_folder_path)
    # 设置你的Exchange账户和服务器信息
    creds = Credentials(username=username, password=password)
    config = Configuration(server=server, credentials=creds)

    # 创建Account对象
    account = Account(primary_smtp_address=username, config=config, autodiscover=False,
                      access_type=DELEGATE)

    # 获取今天的日期
    today = datetime.now(pytz.utc).date()

    # 创建今天午夜的时区感知的datetime对象
    # 创建今天午夜的CST时区感知的datetime对象
    cst_tz = pytz.timezone('Asia/Shanghai')
    start_time = datetime.combine(today, datetime.min.time()).replace(tzinfo=cst_tz)

    # 创建明天午夜的时区感知的datetime对象
    end_time = start_time + timedelta(days=1)

    # 访问收件箱并获取今天收到的邮件
    inbox = account.inbox
    print(start_time, end_time)
    print(inbox)
    messages = inbox.filter(datetime_received__range=(start_time, end_time))
    print(messages)

    # 下载邮件附件
    for message in messages:
        print(f"Subject: {message.subject}")
        print(f"Received at: {message.datetime_received}")

        if "质量" in message.subject and message.attachments:
            for attachment in message.attachments:
                if isinstance(attachment, FileAttachment):
                    file_path = os.path.join(daily_folder_path, attachment.name)
                    with open(file_path, 'wb') as f:
                        f.write(attachment.content)
                    print(f"Downloaded attachment: {attachment.name} to {file_path}")


def delete_non_quality_files(year, month, day):
    fold_path = os.path.join(base_path, '..', '02_DataInput', str(year), str(month), str(day))
    if not os.path.exists(fold_path):
        print(f'文件夹不存在:{fold_path}')
        return
    # 获取文件夹中的所有文件
    files = os.listdir(fold_path)
    for file in files:
        file_path = os.path.join(fold_path, file)
        if os.path.isfile(file_path):
            if file.endswith('.pdf') or file.endswith('.PDF'):
                print(f'文件{file}符合要求，保留')
                logging.info(f'文件{file}符合要求，保留')
            else:
                print(f'文件{file}不符合要求，删除')
                logging.info(f'文件{file}不符合要求，删除')
                os.remove(file_path)


def receiver():
    receiver = Config['Receiver'].rstrip(';').split(';')
    print(receiver)
    return receiver


# 这边对文件夹遍历
def files_in_file(year, month, day):
    fold_path = os.path.join(base_path, '..', '02_DataInput', str(year), str(month), str(day))
    files = os.listdir(fold_path)
    for file in files:
        print(file)
        po, material = file.split('+')
        material = material.split('.')[0]
        print(f'po:{po},material:{material}')
        file_path = os.path.join(fold_path, file)
        print(file_path)
        copy_files_if_conditions_met(Config['Drawing_folder'], po, material, file_path,
                                     Config['Drawing_folder'] + "\\默认路径")


def copy_files_if_conditions_met(root_folder, po, material, file_quality_path, default_destination):
    found_destination = False

    for root, dirs, files in os.walk(root_folder):
        # 检查当前文件夹名称是否以“20”开头
        # if root.startswith(r"..\02_DataInput\20"):
        #     print(f"当前文件夹: {root}是以20开头的文件夹")
        # 遍历六级子文件夹
        for sub_root, sub_dirs, sub_files in os.walk(root):
            # 检查子文件夹名称是否包含“po”和“material”
            if po in sub_root and material in sub_root:
                # 检查子文件夹中是否存在以“file_quality”命名的文件
                file_quality_exists = any(file == os.path.basename(file_quality_path) for file in sub_files)
                if not file_quality_exists:
                    # 获取文件路径
                    source_file_path = file_quality_path
                    destination_folder = sub_root
                    destination_file_path = os.path.join(destination_folder, os.path.basename(file_quality_path))
                    # 复制文件
                    try:
                        shutil.copy2(source_file_path, destination_file_path)
                        print(f"已复制文件: {source_file_path} -> {destination_file_path}")
                        logging.info(f"找到文件夹，已复制文件: {source_file_path} -> {destination_file_path}")
                        # 将参数配置未True
                        found_destination = True
                    except Exception as e:
                        print(f"复制文件 {source_file_path} 到 {destination_file_path} 时出错: {e}")
                        logging.info(f"找到文件夹，已复制文件 {source_file_path} 到 {destination_file_path} 时出错: {e}")
                else:
                    print(f"文件 {os.path.basename(file_quality_path)} 已存在于 {sub_root}，未复制")
                    logging.info(f"文件 {os.path.basename(file_quality_path)} 已存在于 {sub_root}，未复制")

    if not found_destination:
        default_destination_path = os.path.join(default_destination, os.path.basename(file_quality_path))
        if not os.path.exists(default_destination_path):
            try:
                shutil.copy2(file_quality_path, default_destination_path)
                print(f"未匹配到文件，已复制文件: {file_quality_path} -> {default_destination_path}")
                logger.info(f"未匹配到文件，已复制文件: {file_quality_path} -> {default_destination_path}")
            except Exception as e:
                print(f"未匹配到文件，复制文件 {file_quality_path} 到 {default_destination_path} 时出错: {e}")
                logger.error(f"未匹配到文件，复制文件 {file_quality_path} 到 {default_destination_path} 时出错: {e}")
        else:
            print(f"文件 {os.path.basename(file_quality_path)} 已存在于 {default_destination}，未复制")
            logger.info(f"文件 {os.path.basename(file_quality_path)} 已存在于 {default_destination}，未复制")


def main():
    ensure_working_dir()
    config()
    logging_info()
    print(Config['Email_name'])
    download_file('''Mv^"/x$z61KN[?(M+f7l!'%k3<7a@O^'f:):252''' ,'auto@lechler.com.cn','10.86.180.134')
    # 获取当前日期
    now = datetime.now()
    year = str(now.year)
    month = str(now.month).zfill(2)  # 保证两位数
    date = now.strftime("%Y-%m-%d")
    delete_non_quality_files(year,month,date)
    #traverse_directories(Config['DataInput'],'20',)
    files_in_file(year,month,date)
    send_email(Config['AutoJob'] + '_' + date + '-运行完成', Config['Body_name_end'],
               receiver(), 'auto@lechler.com.cn', '''Mv^"/x$z61KN[?(M+f7l!'%k3<7a@O^'f:):252''','10.86.180.134',
               'auto@lechler.com.cn',  '')



if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f'出现异常:{e}')
        logger.error(f'出现异常:{e}')
        logger.error(traceback.format_exc())