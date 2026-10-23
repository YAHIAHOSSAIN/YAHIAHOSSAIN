# Auto Ticket Select (Chrome extension)

Ticket/seat select korar click gulo **ekbar record** korun, tarpor extension nijei shegulo
automatic click kore dibe — seat available na thakle page auto-refresh kore abar try korbe.
Je kono ticket website-e kaj kore (train, bus, launch, movie, event...).

## Install

1. Ei `auto-ticket-select` folder ta download/clone korun.
2. Chrome-e `chrome://extensions` open korun.
3. Upore dan dike **Developer mode** on korun.
4. **Load unpacked** e click kore `auto-ticket-select` folder ta select korun.

## Kivabe use korben

1. Ticket website-e login kore jei page theke ticket select shuru hoy sekhane jan.
2. Extension icon e click → **+ Pick from page** → website-e jei jinish click korte chan
   (jemon class `S_CHAIR`, ba seat) sheta click korun. Protiti step er jonno abar korun, kram onujayi.
3. Proti step e:
   - **Text** – button/seat er lekha diye khuje (`exact` ba `contains`).
     Jemon `contains` + kichu na diye shudhu seat er common lekha dile je kono khali seat nibe.
   - **CSS selector** – nirdishto element (jemon `.seat.available`).
   - **×N** – koyta matching item click korbe (jemon 2 ta seat).
4. **Wait per step** – element ashar jonno koto second opekkha korbe.
   **Auto-refresh** – na pele koto second por page reload kore abar try korbe (0 = off, minimum 3s).
5. **▶ Start** chapun. Kaj shesh hole notification + sound pabe.

Booked / disabled seat (class e `booked`, `sold`, `disabled`, `unavailable`, `reserved` thakle) automatic skip hoy.

## Limitations (iccha kore)

- **Captcha solve kore na** — captcha dekhle thame ar apnake janay.
- **Payment kore na** — select porjonto kore, baki booking/payment apni nije korben.
- Website er terms of service mene cholun; khub choto refresh interval dile site apnake block korte pare.

## Files

| File | Kaj |
| --- | --- |
| `manifest.json` | Extension config (Manifest V3) |
| `content.js` | Page e step gulo run kore, picker, captcha detection |
| `popup.html/js/css` | Steps ar settings er UI |
| `background.js` | Desktop notification |
