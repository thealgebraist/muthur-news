# MU/TH/UR Gemini bulletin Worker

This Cloudflare Worker keeps the Gemini key out of the public GitHub Pages
bundle. It fetches the same two public news feeds as the browser, asks Gemini
3.6 Flash to condense each record into exactly four display lines, retains
the original URL and timestamp, and caches the resulting batch for five minutes.
The `/ask` route also supports terminal questions. Gemini can call one bounded
`search_news` tool that searches the current feed buffer and returns the source
links used in the answer.

If Gemini is unavailable or its free quota is exhausted, the Worker returns the
unmodified source bulletins with `mode: "source-only"`. The website has a second
fallback that fetches its existing public feeds directly if the Worker itself
cannot be reached.

## Configure

1. Create a free Gemini API key in Google AI Studio:
   <https://aistudio.google.com/app/apikey>
2. Authenticate Wrangler:

   ```sh
   npx wrangler login
   ```

3. Add the key as an encrypted Worker secret. Do not put it in `.dev.vars`,
   JavaScript, Git, or a GitHub Pages file:

   ```sh
   npx wrangler secret put GEMINI_API_KEY
   ```

4. Deploy:

   ```sh
   npm run deploy
   ```

5. Copy the resulting `https://…workers.dev` URL into `web/config.js` as
   `aiEndpoint`, with `/bulletins` appended.

The production CORS list currently permits the published GitHub Pages origin
and local development on port 9999. Change `ALLOWED_ORIGINS` in
`wrangler.jsonc` if the site moves.

The public API routes are:

- `GET /bulletins` — cached four-line bulletin batch
- `POST /ask` with `{"question":"..."}` — model answer with optional news-tool results
- `GET/POST /general-cache` — five-minute Cloudflare Cache API storage for the
  512-signal general-news corpus and completed digest, so repeated `G` requests
  do not consume additional Gemini tokens
- `GET /health` — configuration status without exposing the secret

## Local test

```sh
npm install
npm test
npx wrangler dev
```

For live local Gemini calls only, create the ignored `worker/.dev.vars` file
below. This is the one local-only exception; never commit it:

```text
GEMINI_API_KEY=your_key_here
```
