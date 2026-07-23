# MU/TH/UR Meet Interface

This optional Chrome extension applies the terminal theme to the real Google
Meet page. It does not access camera, microphone, meeting content, or network
traffic. It only injects CSS, a status header, and a UTC clock.

## Install locally

1. Download this `meet-extension` folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this folder.
5. Open or reload a page at `https://meet.google.com/`.

Press `Ctrl+Shift+M` inside Meet to temporarily toggle the theme.

Google changes Meet's internal markup periodically. The extension deliberately
uses broad accessibility selectors so core controls keep working, but its visual
coverage may need adjustment after a major Meet redesign.
