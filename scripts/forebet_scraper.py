import asyncio
import csv
import re
from pathlib import Path
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup

OUTPUT_FILE = Path(__file__).parent.parent / "UpcomingClean_Friday.csv"
URL = "https://www.forebet.com/en/basketball/predictions-tomorrow"

# Required 25-column format for Ma Golide UpcomingClean
COLUMNS = [
    "League", "Game Type", "Home", "Away", "Date", "Time", "Prob %", 
    "Pred", "Pred Score", "Avg", "Odds", "Q1", "Q2", "Q3", "Q4", "OT", 
    "Status", "FT Score", "t2-q1", "t2-q2", "t2-q3", "t2-q4", 
    "t2-q1-conf", "t2-q2-conf", "t2-q3-conf"
]

async def scrape_forebet():
    print(f"🚀 Launching stealth browser to bypass Cloudflare...")
    async with async_playwright() as p:
        # Launch browser headlessly
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800}
        )
        page = await context.new_page()
        
        print(f"📡 Navigating to Forebet Predictions (Tomorrow)...")
        await page.goto(URL, wait_until="domcontentloaded")
        
        # Give it a second to render the table
        await page.wait_for_timeout(3000)
        
        html = await page.content()
        await browser.close()
        
    print("🧩 Parsing DOM structure...")
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.find_all("div", class_="rcnt")
    
    parsed_games = []
    
    for row in rows:
        try:
            # 1. Teams & Time
            tnmscn = row.find("a", class_="tnmscn")
            if not tnmscn: continue
            
            spans = tnmscn.find_all("span", recursive=False)
            if len(spans) < 3: continue
            
            home_team = spans[0].get_text(strip=True)
            away_team = spans[1].get_text(strip=True)
            datetime_str = spans[2].get_text(strip=True) # e.g. "01/05/2026 0:30"
            
            parts = datetime_str.split(" ")
            date_val = parts[0] if len(parts) > 0 else ""
            time_val = parts[1] if len(parts) > 1 else ""
            
            # League (extract from href, e.g. /en/basketball/matches/nbb/...)
            href = tnmscn.get("href", "")
            league = "UNKNOWN"
            if "/matches/" in href:
                league = href.split("/matches/")[1].split("/")[0].upper()
            
            # 2. Probabilities (1, X, 2 or just 1, 2)
            fprcs = row.find_all("div", class_="fprc")
            probs = [p.get_text(strip=True) for p in fprcs]
            prob_str = " - ".join(probs) if probs else ""
            
            # 3. Prediction (1, X, 2)
            predict_div = row.find("div", class_="predict")
            pred = predict_div.get_text(strip=True) if predict_div else ""
            
            # 4. Predicted Score
            ex_scs = row.find_all("div", class_="ex_sc")
            pred_score = ""
            if len(ex_scs) >= 2:
                pred_score = f"{ex_scs[0].get_text(strip=True)} - {ex_scs[1].get_text(strip=True)}"
                
            # 5. Average Points
            avg_p = row.find("div", class_="avg_p")
            avg_val = avg_p.get_text(strip=True) if avg_p else ""
            
            # 6. Odds
            lscrsp = row.find("span", class_="lscrsp")
            odds_val = lscrsp.get_text(strip=True) if lscrsp else ""
            
            # Build 25-col row matching Ma Golide format
            game_row = {col: "" for col in COLUMNS}
            game_row["League"] = league
            game_row["Game Type"] = "Regular Season"
            game_row["Home"] = home_team
            game_row["Away"] = away_team
            game_row["Date"] = date_val
            game_row["Time"] = time_val
            game_row["Prob %"] = prob_str
            game_row["Pred"] = pred
            game_row["Pred Score"] = pred_score
            game_row["Avg"] = avg_val
            game_row["Odds"] = odds_val
            game_row["Status"] = "Scheduled"
            
            parsed_games.append(game_row)
            
        except Exception as e:
            print(f"Skipping row due to parse error: {e}")
            continue

    print(f"✅ Successfully extracted {len(parsed_games)} games!")
    
    # Write to CSV
    with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        for game in parsed_games:
            writer.writerow(game)
            
    print(f"💾 Saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    asyncio.run(scrape_forebet())
