"""
一次性小工具：在本機（第二台筆電）跑這支腳本，用瀏覽器登入 Google 帳號授權一次，
拿到可以長期使用的 refresh token，之後部署到 Render 時把它設成環境變數即可，
Render 上的機器人不需要再開瀏覽器登入。

使用方式：
    1. 到 Google Cloud Console 建立 OAuth 用戶端 ID（類型選「電腦版應用程式」），
       下載 JSON，存成這個資料夾底下的 credentials.json（README 有詳細步驟）。
    2. 執行： .\\venv\\Scripts\\python get_refresh_token.py
    3. 瀏覽器會自動打開，選你要串接的 Google 帳號、按同意。
    4. 終端機會印出 CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN，
       這三個值要設到 Render 的環境變數。
"""
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/calendar.events"]


def main():
    flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
    creds = flow.run_local_server(port=0)

    print("\n授權成功！請把以下三個值設成 Render 的環境變數：\n")
    print(f"GOOGLE_CLIENT_ID={creds.client_id}")
    print(f"GOOGLE_CLIENT_SECRET={creds.client_secret}")
    print(f"GOOGLE_REFRESH_TOKEN={creds.refresh_token}")
    print("\n這三個值等同於你 Google 帳號的鑰匙，請勿分享給別人或提交到 git。")


if __name__ == "__main__":
    main()
