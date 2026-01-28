# Website Analytics Setup Guide

## ✅ Implemented: Plausible Analytics

**Status:** Analytics tracking code has been added to all HTML pages.

---

## Why Plausible Analytics?

### Advantages
- ✅ **No cookies** - fully GDPR/CCPA compliant by default
- ✅ **Lightweight** - <1KB script (vs GA4's ~45KB)
- ✅ **Privacy-first** - doesn't track personal data or use cookies
- ✅ **Simple** - no cookie consent banners needed
- ✅ **Open source** - transparent and trustworthy
- ✅ **Great UI** - clean, simple dashboard
- ✅ **Minimal performance impact** - loads asynchronously

### What it Tracks
- Page views
- Unique visitors (privacy-friendly, no personal data)
- Referrer sources (where visitors come from)
- Device type (desktop, mobile, tablet)
- Browser and OS
- Country/region (without IP logging)
- Custom events (if configured)

---

## Setup Steps

### 1. Sign up for Plausible
1. Go to [plausible.io](https://plausible.io)
2. Create an account (free 30-day trial, then $9/month for up to 10k visitors)
3. Add your domain: `gilbertbaidya.netlify.app`

### 2. Verify Installation
The tracking script is already added to all your HTML pages:

```html
<!-- Analytics: Plausible (Privacy-friendly, GDPR compliant, no cookies) -->
<script defer data-domain="gilbertbaidya.netlify.app" src="https://plausible.io/js/script.js"></script>
```

### 3. Deploy to Netlify
```bash
git add -A
git commit -m "Added Plausible analytics tracking to all pages"
git push origin master
```

Netlify will automatically deploy your changes.

### 4. Verify Tracking Works
1. Visit your live site: `https://gilbertbaidya.netlify.app`
2. Log into your Plausible dashboard
3. You should see your visit appear within ~30 seconds

---

## Files Updated

Analytics script added to:
- ✅ `index.html` (homepage)
- ✅ `blog.html` (blog listing)
- ✅ `article-template.html` (template)
- ✅ `blog-post-template.html` (template)
- ✅ `ai-assisted-qa-pipeline.html`
- ✅ `wcag-2-2-readiness.html`
- ✅ `modernizing-legacy-automation.html`
- ✅ `accessibility-first-qa-culture.html`
- ✅ `agentic-test-orchestration.html`
- ✅ `reducing-flaky-tests.html`

---

## Technical Details

### Script Explanation
```html
<script defer data-domain="gilbertbaidya.netlify.app" src="https://plausible.io/js/script.js"></script>
```

- **`defer`** - Script loads asynchronously, doesn't block page rendering
- **`data-domain`** - Your website domain (Plausible uses this to identify your site)
- **`src`** - Plausible's tracking script (hosted on their CDN)

### How it Works
1. Script loads asynchronously (no performance impact)
2. On page load, sends a pageview event to Plausible
3. No cookies are set (privacy-friendly)
4. No personal data is collected
5. IP addresses are not stored
6. Data is aggregated and anonymized

### Privacy Compliance
- ✅ **GDPR compliant** - no personal data collection
- ✅ **CCPA compliant** - no selling of data
- ✅ **Cookie-free** - no cookie consent banner needed
- ✅ **Transparent** - open source code
- ✅ **Data ownership** - you own your analytics data

---

## Alternative: Google Analytics GA4

If you prefer Google Analytics instead, here's how to switch:

### 1. Get Your GA4 Measurement ID
1. Create a GA4 property at [analytics.google.com](https://analytics.google.com)
2. Copy your Measurement ID (format: `G-XXXXXXXXXX`)

### 2. Replace Script in All HTML Files

**Remove:**
```html
<!-- Analytics: Plausible (Privacy-friendly, GDPR compliant, no cookies) -->
<script defer data-domain="gilbertbaidya.netlify.app" src="https://plausible.io/js/script.js"></script>
```

**Replace with:**
```html
<!-- Google Analytics GA4 -->
<!-- Replace G-XXXXXXXXXX with your actual Measurement ID -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

### 3. GA4 Considerations
⚠️ **Requires cookie consent banner** (GDPR/CCPA compliance)  
⚠️ **Larger script size** (~45KB vs Plausible's <1KB)  
⚠️ **More complex** - steeper learning curve  
⚠️ **Privacy concerns** - collects more data  
✅ **More features** - advanced analytics, conversion tracking, integrations

---

## Monitoring & Maintenance

### Check Analytics Dashboard
- **Plausible:** Log in to [plausible.io](https://plausible.io)
- View real-time stats, top pages, referrers, devices

### No Maintenance Required
- Script is hosted by Plausible (always up-to-date)
- No updates needed on your end
- Automatic compatibility with all browsers

### Troubleshooting

**Not seeing data?**
1. Check that the domain in your Plausible account matches exactly: `gilbertbaidya.netlify.app`
2. Visit your live site (not localhost)
3. Disable ad blockers temporarily
4. Check browser console for errors (F12)
5. Wait 30-60 seconds for data to appear

**Script blocked by ad blocker?**
- Plausible is often blocked by privacy extensions
- This is expected and normal
- Your actual visitors without ad blockers will be tracked

---

## Cost

### Plausible Pricing
- **Trial:** 30 days free
- **Starter:** $9/month (up to 10k monthly pageviews)
- **Growth:** $19/month (up to 100k monthly pageviews)

### Google Analytics GA4
- **Free** - no cost
- But requires cookie consent implementation

---

## Recommendation

**Stick with Plausible** for:
- Privacy compliance without cookie banners
- Simple, clean analytics
- Fast page load times
- Ethical data collection

**Switch to GA4** if you need:
- Advanced conversion tracking
- E-commerce tracking
- Integration with Google Ads
- Complex funnel analysis

---

## Next Steps

1. ✅ **Analytics code added** - Done!
2. 🔄 **Sign up for Plausible** - Create your account
3. 🚀 **Deploy to Netlify** - Push changes to GitHub
4. 📊 **Monitor dashboard** - Start seeing visitor data

---

## Support

- **Plausible Docs:** https://plausible.io/docs
- **Plausible Support:** support@plausible.io
- **Status Page:** https://plausible.io/status

---

**Last Updated:** January 27, 2026  
**Implementation:** Complete ✅  
**Ready for Production:** Yes 🚀
