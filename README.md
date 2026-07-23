# MU/TH/UR News Relay

A zero-build HTML/CSS/JavaScript news terminal inspired by the industrial CRT
language of the MU/TH/UR interface. It displays a different bulletin every 15
seconds.

## Run

From the repository root:

```sh
python3 -m http.server 9999 -d web
```

Then open <http://localhost:9999>.

## Live public services

- [Spaceflight News API](https://www.spaceflightnewsapi.net/) for current space
  and science reporting.
- [HN Search API](https://hn.algolia.com/api) for current technology stories.

Both are keyless browser endpoints. The terminal merges and deduplicates their
results, refreshes the pool every five minutes, and marks the display as
`OFFLINE / ARCHIVE` if neither service is reachable. The bundled archive is
clearly identified and never presented as live news.

## Controls

- `Space`: pause or resume the 15-second cycle
- `N`: advance to the next bulletin
- `R`: refresh the public feeds
- `S`: toggle the short transition tone

The sound option uses original Web Audio synthesis: a low electrical hum,
power-up sweep, filtered noise, character ticks, and completion tones. Browsers
require a key press or click before audio can start, so sound defaults to off.
No audio from the film or reference video is bundled.

## Google Meet companion

`meet.html` is a MU/TH/UR-styled launch console for Google Meet. Enter a Meet
code or `meet.google.com` URL and it opens the real call in a separate tab, where
Google continues to own authentication, camera, and microphone permissions.

An optional unpacked Chrome extension is included in `meet-extension`. It adds
the CRT treatment and instrument header directly to the real Meet page. A normal
web page cannot read or restyle an embedded cross-origin Meet interface, so the
extension is the only part that changes Meet itself. The site also provides
`assets/muthur-meet-extension.zip` as a convenient download; unzip it before
using Chrome's **Load unpacked** command.

The current generated visual concept is stored at
`assets/muthur-news-concept-v2.png`.

The bundled [VT323](https://fonts.google.com/specimen/VT323) terminal font is
licensed under the SIL Open Font License; the license text is included at
`assets/OFL-VT323.txt`.
