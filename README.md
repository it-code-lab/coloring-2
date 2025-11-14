# 🎨 Creative Cubs Coloring Web App

## Overview
**Creative Cubs Coloring Studio** is a browser-based coloring experience that lets users pick themed coloring pages, paint with brushes or tap-to-fill colors, and download their finished artwork.  
It’s built to be fast, mobile-friendly, and ready for Android app reuse.

---

## 🧱 Architecture

| Layer | Description |
|-------|--------------|
| **Frontend** | Pure HTML + CSS + Vanilla JS. Loads coloring pages from a manifest JSON. |
| **Manifest System** | Lists categories and pages (URLs, thumbnails, dimensions). Built automatically by `build_manifest.php`. |
| **Image Assets** | Stored under `/static/v#/category/pages/*.png` with `/thumbs/*.webp` thumbnails. |
| **Backend** | Only for static serving and manifest generation (`build_manifest.php`). No user uploads or database. |
| **Ad System** | Banner, native, sticky mobile, and interstitial ad containers with logic to control frequency and timing. |
| **Android App Compatibility** | Same manifest JSON consumed by mobile app for identical theme/page listing. |

---

## 📂 Folder Structure

```
/public_html/
├── index.html                  ← redirect or landing
├── coloring/
│   ├── index.html              ← main web app
│   ├── manifests/
│   │   ├── v1.json
│   │   └── latest.json
│   ├── static/
│   │   ├── v1/
│   │   │   ├── jungle-safari/
│   │   │   │   ├── pages/
│   │   │   │   └── thumbs/
│   │   │   └── ocean-sea-life/
│   │   └── v2/…
│   ├── build_manifest.php      ← manifest generator
│   ├── scripts/                ← optional separated JS modules
│   ├── assets/                 ← icons, logos, UI images
│   └── .htaccess               ← cache/CORS rules
└── ads.txt                     ← AdSense / AdMob verification
```

---

## ⚙️ Manifest Generation (`build_manifest.php`)

### Purpose
Scans each `pages/` directory, generates missing `thumbs/@2x.webp`, and writes JSON manifest under `/manifests/v#.json`.

### CLI Usage
```bash
php -d max_execution_time=0 build_manifest.php version=v1 force=0
```

| Option | Meaning |
|--------|----------|
| `version` | Target version folder under `/static/`. |
| `force=1` | Rebuild all thumbnails even if they exist. |
| `force=0` | Skip existing thumbs (fast resume). |

### Output
`/coloring/manifests/v1.json`
```json
{
  "version": "v1",
  "updated_at": "2025-11-13T20:00:00Z",
  "categories": [
    {
      "id": "jungle-safari",
      "title": "Jungle Safari",
      "items": [
        {
          "id": "elephant-family",
          "label": "Elephant Family",
          "src": "https://coloring.readernook.com/coloring/static/v1/jungle-safari/pages/elephant-family.png",
          "thumb": "https://coloring.readernook.com/coloring/static/v1/jungle-safari/thumbs/elephant-family@2x.webp",
          "w": 1600,
          "h": 1200
        }
      ]
    }
  ]
}
```

---

## 🖼 Frontend Components

### Key Scripts
| Function | Role |
|-----------|------|
| `fetchManifestWithCache()` | Fetches `/manifests/latest.json` and stores locally for offline fallback. |
| `mapManifestToPages()` | Converts manifest JSON into `{ "Category": [pages...] }` object for UI. |
| `buildCategories()` | Populates left sidebar category buttons. |
| `selectCategory(cat)` | Loads thumbnails for the selected category; first page auto-loads. |
| `loadPage(src, resetUndo, pageObj)` | Loads image onto `lineCanvas`; wrapper counts page changes for interstitial ads. |
| `floodFill()` & `draw()` | Tap-to-fill and brush coloring logic. |
| `saveArtwork()` | Exports canvas as image with watermark `© Creative Cubs | Personal use only`. |

### Canvases
- `lineCanvas` — base black-and-white outline.
- `drawCanvas` — user coloring layer (merged for downloads).

---

## 💰 Ad Integration

### Slots & Placement
| Type | Location | Trigger | Notes |
|------|-----------|----------|-------|
| **Banner** | Top, fixed height | Always visible | Reserved space → no layout shift. |
| **Native** | Between thumbnail list & hint | Always visible | Blends with content. |
| **Sticky Mobile** | Bottom (≤ 900 px width) | Always visible except in Focus Mode | Responsive banner. |
| **Interstitial** | Center overlay | After every 4th page change, once per session | 3-second “Close” countdown. |

### AdSense Embedding
Replace placeholders:
```html
<!-- PASTE YOUR ADSENSE TAG HERE -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-XXXXXXXXXXXX"
     data-ad-slot="YYYYYYYYYY"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
```

### Focus Mode Behavior
CSS class `.focus-mode` hides `ad-top` and `ad-sticky` for a distraction-free workspace.

---

## 📱 Android App Integration

- The Android app fetches `https://coloring.readernook.com/coloring/manifests/latest.json`.
- Thumbnails populate the gallery; `src` PNGs load into the app’s coloring view.
- CORS enabled via `.htaccess`:
  ```apache
  <FilesMatch "\.(png|webp|json)$">
      Header set Access-Control-Allow-Origin "*"
      Header set Cache-Control "public, max-age=31536000"
  </FilesMatch>
  ```

---

## 🧭 Versioning & Deployment Steps

1. Upload new image sets under `/static/v#/<category>/pages/`.
2. Run:
   ```bash
   php build_manifest.php version=v2
   ```
3. Copy or symlink:
   ```bash
   cp manifests/v2.json manifests/latest.json
   ```
4. Purge CDN / Cloudflare cache for `/manifests/*`.
5. Visit the site to verify new categories load automatically.

---

## 🧩 Developer Notes

### Local Setup
1. Install PHP 8+ and enable `gd` or `imagick` extension.
2. Run via XAMPP/Apache:
   ```
   http://localhost/coloring/index.html
   ```
3. To rebuild manifests locally:
   ```
   php -d max_execution_time=0 coloring/build_manifest.php version=v1
   ```

### Common Errors
| Error | Cause | Fix |
|-------|-------|-----|
| `Call to undefined function imagecreatefrompng()` | GD extension disabled | Enable `extension=gd` in `php.ini`. |
| `Maximum execution time exceeded` | Too many images | Run via CLI with `max_execution_time=0`. |
| Thumbnails missing | No GD/Imagick | Upload pre-made `.webp` or skip generation. |

---

## 🔐 Privacy & Compliance
- Mark site as “child-directed” in AdSense to serve compliant ads.  
- Use **non-personalized ads (NPA)** if under 13 audience.  
- Add privacy link or modal: “We use ads to keep this site free. See our Privacy Policy.”

---

## 🔄 Future Enhancements
- Color palettes save / load in LocalStorage  
- Undo/Redo stack limit  
- Progressive Web App (PWA) for offline use  
- Rewarded ads unlock premium pages  
- Multi-language UI  
- Serverless Lambda manifest builder for scalability  

---

## 👩‍💻 Maintenance Checklist
| Interval | Task |
|-----------|------|
| Weekly | Review analytics (sessions, ad RPM, bounce rate). |
| Monthly | Add new themes (seasonal packs). |
| Quarterly | Rebuild manifest (`vN+1`) and update latest.json. |
| Yearly | Renew AdSense policy & check compliance. |

---

## 🧾 License / Attribution
All artwork © Creative Cubs. Personal use only.  
Website code MIT licensed unless otherwise noted.
