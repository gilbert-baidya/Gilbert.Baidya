# Contact Form Setup Instructions

Your contact form is ready to receive emails! Follow these simple steps to activate it:

## Option 1: Formspree (Recommended - Free & Easy)

### Step 1: Sign Up
1. Go to [formspree.io](https://formspree.io/)
2. Click "Get Started" (it's FREE)
3. Sign up with your email (gilbert.baidya@gmail.com)

### Step 2: Create Your Form
1. After login, click "+ New Form"
2. Name it: "Portfolio Contact Form"
3. Your email will be automatically set to receive messages
4. Copy the form endpoint (looks like: `https://formspree.io/f/xyzabc123`)

### Step 3: Update Your Website
1. Open `index.html`
2. Find line with: `action="https://formspree.io/f/YOUR_FORM_ID"`
3. Replace `YOUR_FORM_ID` with your actual form ID
4. Save and push to GitHub

### Step 4: Test It
1. Visit your website: https://gilbertbaidya.netlify.app/
2. Go to Contact section
3. Send a test message
4. Check your email (gilbert.baidya@gmail.com)

**That's it!** You'll now receive all contact form submissions directly to your email.

---

## Option 2: Netlify Forms (Alternative - Also Free)

If you prefer Netlify's built-in forms:

### Step 1: Update Form Tag
Replace the form opening tag with:
```html
<form class="contact-form" id="contactForm" name="contact" method="POST" data-netlify="true">
```

### Step 2: Add Netlify Hidden Input
Add this inside the form (after the opening tag):
```html
<input type="hidden" name="form-name" value="contact">
```

### Step 3: Push to GitHub
Netlify will automatically detect the form and handle submissions.

### Step 4: Configure Email Notifications
1. Go to Netlify Dashboard
2. Select your site
3. Go to Forms → Notifications
4. Add email notification to: gilbert.baidya@gmail.com

---

## Option 3: EmailJS (JavaScript-based)

If you want a pure JavaScript solution:

1. Sign up at [emailjs.com](https://www.emailjs.com/)
2. Create an email service
3. Create an email template
4. Get your Service ID, Template ID, and Public Key
5. Update the JavaScript code

---

## Which Should You Choose?

- **Formspree**: Easiest, 5 minutes setup, 50 submissions/month free
- **Netlify Forms**: Built-in, 100 submissions/month free, good if you like Netlify
- **EmailJS**: More customizable, 200 emails/month free

**Recommendation**: Start with Formspree - it's the quickest and simplest!

---

## Current Status

✅ Form HTML is ready
✅ JavaScript handling is ready
⏳ Needs Formspree Form ID (YOUR_FORM_ID)

Just complete Step 2 above and you're done!
