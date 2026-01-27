// ========================================
// Smooth Scrolling & Navigation
// ========================================

let lenisInstance = null;

document.addEventListener('DOMContentLoaded', function () {
    if (typeof Lenis !== 'undefined') {
        document.documentElement.style.scrollBehavior = 'auto';

        lenisInstance = new Lenis({
            duration: 1.35,
            easing: (t) => 1 - Math.pow(1 - t, 3),
            smoothWheel: true,
            smoothTouch: false,
            wheelMultiplier: 0.9,
            touchMultiplier: 1.2,
            lerp: 0.08
        });

        window.lenis = lenisInstance;

        function raf(time) {
            lenisInstance.raf(time);
            requestAnimationFrame(raf);
        }

        requestAnimationFrame(raf);

        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', (event) => {
                const targetId = anchor.getAttribute('href');
                const targetEl = document.querySelector(targetId);

                if (targetEl) {
                    event.preventDefault();
                    lenisInstance.scrollTo(targetEl, {
                        offset: -90,
                        duration: 1.4,
                        easing: (t) => 1 - Math.pow(1 - t, 3)
                    });
                }
            });
        });
    }
});

document.addEventListener('DOMContentLoaded', function () {
    // Mobile menu toggle
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('nav-menu');

    const toggleMenu = () => {
        if (!hamburger || !navMenu) return;
        const isExpanded = navMenu.classList.toggle('active');

        // Update ARIA attribute for accessibility
        hamburger.setAttribute('aria-expanded', String(isExpanded));

        // Animate hamburger
        const spans = hamburger.querySelectorAll('span');
        if (spans.length >= 3) {
            spans[0].style.transform = isExpanded ? 'rotate(45deg) translate(5px, 5px)' : '';
            spans[1].style.opacity = isExpanded ? '0' : '1';
            spans[2].style.transform = isExpanded ? 'rotate(-45deg) translate(7px, -6px)' : '';
        }
    };

    if (hamburger) {
        hamburger.addEventListener('click', toggleMenu);
        hamburger.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleMenu();
            }
        });
    }

    // Close mobile menu when clicking on a link
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (!navMenu) return;
            navMenu.classList.remove('active');

            // Reset ARIA attribute
            if (hamburger) {
                hamburger.setAttribute('aria-expanded', 'false');

                // Reset hamburger animation
                const spans = hamburger.querySelectorAll('span');
                if (spans.length >= 3) {
                    spans[0].style.transform = '';
                    spans[1].style.opacity = '1';
                    spans[2].style.transform = '';
                }
            }
        });
    });

    // Navbar scroll effect
    const navbar = document.getElementById('navbar');
    let lastScroll = 0;

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;

        if (currentScroll <= 0) {
            navbar.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
        } else {
            navbar.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
        }

        lastScroll = currentScroll;
    });

    // Active navigation link highlighting
    const sections = document.querySelectorAll('section[id]');

    function highlightNavigation() {
        const scrollY = window.pageYOffset;

        sections.forEach(section => {
            const sectionHeight = section.offsetHeight;
            const sectionTop = section.offsetTop - 100;
            const sectionId = section.getAttribute('id');

            if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
                document.querySelector('.nav-link[href*=' + sectionId + ']')?.classList.add('active');
            } else {
                document.querySelector('.nav-link[href*=' + sectionId + ']')?.classList.remove('active');
            }
        });
    }

    window.addEventListener('scroll', highlightNavigation);
});

// ========================================
// Scroll Animations
// ========================================

// Intersection Observer for fade-in animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver(function (entries) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// Observe elements for animation
document.addEventListener('DOMContentLoaded', function () {
    const animateElements = document.querySelectorAll('.expertise-card, .timeline-item, .education-item, .cert-item');

    animateElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
});

// ========================================
// Contact Form Handling with Formspree
// ========================================

const contactForm = document.getElementById('contactForm');

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

if (contactForm) {
    contactForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const nameInput = contactForm.querySelector('#name');
        const emailInput = contactForm.querySelector('#email');
        const subjectInput = contactForm.querySelector('#subject');
        const messageInput = contactForm.querySelector('#message');

        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const subject = subjectInput.value.trim();
        const message = messageInput.value.trim();

        let hasError = false;

        const setInvalid = (input, invalid) => {
            input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
        };

        if (!name) {
            setInvalid(nameInput, true);
            hasError = true;
        } else {
            setInvalid(nameInput, false);
        }

        if (!email || !isValidEmail(email)) {
            setInvalid(emailInput, true);
            hasError = true;
        } else {
            setInvalid(emailInput, false);
        }

        if (!subject) {
            setInvalid(subjectInput, true);
            hasError = true;
        } else {
            setInvalid(subjectInput, false);
        }

        if (!message || message.length < 10) {
            setInvalid(messageInput, true);
            hasError = true;
        } else {
            setInvalid(messageInput, false);
        }

        if (hasError) {
            showNotification('Please complete all required fields with valid information.', 'info');
            return;
        }

        const submitButton = contactForm.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.innerHTML;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
        submitButton.disabled = true;

        try {
            const response = await fetch(contactForm.action, {
                method: 'POST',
                body: new FormData(contactForm),
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                showNotification('Thank you! Your message has been sent successfully.', 'success');
                contactForm.reset();
            } else {
                showNotification('Sorry, something went wrong. Please try again.', 'info');
            }
        } catch (error) {
            showNotification('Network error. Please check your connection and try again.', 'info');
        } finally {
            submitButton.innerHTML = originalButtonText;
            submitButton.disabled = false;
        }
    });
}

// ========================================
// Notification System
// ========================================

function showNotification(message, type = 'info') {
    // Remove existing notification
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;

    // Add styles
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : '#3b82f6'};
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        z-index: 10000;
        animation: slideInRight 0.3s ease;
    `;

    document.body.appendChild(notification);

    // Remove after 5 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
    
    .notification-content {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    
    .notification-content i {
        font-size: 20px;
    }
`;
document.head.appendChild(style);

// ========================================
// Skills Progress Animation
// ========================================

document.addEventListener('DOMContentLoaded', function () {
    const skillFills = document.querySelectorAll('.skill-fill');
    if (skillFills.length === 0) return;

    const skillsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const fill = entry.target;
                const level = fill.getAttribute('data-level');
                if (level) {
                    requestAnimationFrame(() => {
                        fill.style.width = `${level}%`;
                    });
                }
                skillsObserver.unobserve(fill);
            }
        });
    }, { threshold: 0.4 });

    skillFills.forEach(fill => {
        fill.style.width = '0%';
        skillsObserver.observe(fill);
    });
});

// ========================================
// Typing Effect for Hero Title
// ========================================

document.addEventListener('DOMContentLoaded', function () {
    const heroSubtitle = document.querySelector('.hero-subtitle');

    if (heroSubtitle) {
        const text = heroSubtitle.textContent;
        heroSubtitle.textContent = '';
        heroSubtitle.style.borderRight = '2px solid';
        heroSubtitle.style.paddingRight = '5px';

        let i = 0;
        const typeWriter = () => {
            if (i < text.length) {
                heroSubtitle.textContent += text.charAt(i);
                i++;
                setTimeout(typeWriter, 50);
            } else {
                // Remove cursor after typing
                setTimeout(() => {
                    heroSubtitle.style.borderRight = 'none';
                }, 500);
            }
        };

        // Start typing after a short delay
        setTimeout(typeWriter, 1000);
    }
});

// ========================================
// Counter Animation for Stats
// ========================================

function animateCounter(element, target, duration = 2000) {
    let start = null;
    const from = 0;
    const to = Number(target);

    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    const step = (timestamp) => {
        if (!start) start = timestamp;
        const progress = Math.min((timestamp - start) / duration, 1);
        const eased = easeOutCubic(progress);
        const value = Math.floor(from + (to - from) * eased);
        element.textContent = value;

        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            element.textContent = to;
        }
    };

    requestAnimationFrame(step);
}

document.addEventListener('DOMContentLoaded', function () {
    const statValues = document.querySelectorAll('.stat-value[data-target]');

    if (statValues.length === 0) return;

    const statsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.classList.contains('counted')) {
                const target = entry.target.getAttribute('data-target');
                animateCounter(entry.target, target, 2000);
                entry.target.classList.add('counted');
                statsObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.6 });

    statValues.forEach(stat => statsObserver.observe(stat));
});

// ========================================
// Reading Time Calculation
// ========================================

document.addEventListener('DOMContentLoaded', function () {
    const readingTargets = document.querySelectorAll('[data-reading-content]');
    const readingBadge = document.querySelector('.reading-time');

    if (readingTargets.length === 0 || !readingBadge) return;

    const wordsPerMinute = Number(readingBadge.getAttribute('data-words-per-minute')) || 200;

    let wordCount = 0;
    readingTargets.forEach(target => {
        const text = target.textContent || '';
        wordCount += text.trim().split(/\s+/).filter(Boolean).length;
    });

    const minutes = Math.max(1, Math.ceil(wordCount / wordsPerMinute));
    readingBadge.textContent = `${minutes} min read`;
});

// ========================================
// Scroll to Top Button
// ========================================

document.addEventListener('DOMContentLoaded', function () {
    // Create scroll to top button
    const scrollTopBtn = document.createElement('button');
    scrollTopBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
    scrollTopBtn.className = 'scroll-top-btn';
    scrollTopBtn.setAttribute('aria-label', 'Scroll to top');

    scrollTopBtn.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        width: 50px;
        height: 50px;
        background: linear-gradient(135deg, #2563eb, #3b82f6);
        color: white;
        border: none;
        border-radius: 50%;
        font-size: 20px;
        cursor: pointer;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s ease;
        z-index: 999;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    `;

    document.body.appendChild(scrollTopBtn);

    // Show/hide button on scroll
    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 300) {
            scrollTopBtn.style.opacity = '1';
            scrollTopBtn.style.visibility = 'visible';
        } else {
            scrollTopBtn.style.opacity = '0';
            scrollTopBtn.style.visibility = 'hidden';
        }
    });

    // Scroll to top on click
    scrollTopBtn.addEventListener('click', () => {
        if (window.lenis) {
            window.lenis.scrollTo(0, { duration: 1.3, easing: (t) => 1 - Math.pow(1 - t, 3) });
        } else {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        }
    });

    // Hover effect
    scrollTopBtn.addEventListener('mouseenter', () => {
        scrollTopBtn.style.transform = 'translateY(-5px) scale(1.1)';
        scrollTopBtn.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.2)';
    });

    scrollTopBtn.addEventListener('mouseleave', () => {
        scrollTopBtn.style.transform = 'translateY(0) scale(1)';
        scrollTopBtn.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
    });
});

// ========================================
// Parallax Effect for Hero Section
// ========================================

window.addEventListener('scroll', () => {
    const scrolled = window.pageYOffset;
    const heroContent = document.querySelector('.hero-content');

    if (heroContent && scrolled < window.innerHeight) {
        heroContent.style.transform = `translateY(${scrolled * 0.5}px)`;
        heroContent.style.opacity = 1 - (scrolled / 600);
    }
});

// ========================================
// Cursor Trail Effect (Optional)
// ========================================

document.addEventListener('DOMContentLoaded', function () {
    const coords = { x: 0, y: 0 };
    const circles = document.querySelectorAll('.circle');

    // Only add cursor effect on larger screens
    if (window.innerWidth > 768) {
        for (let i = 0; i < 20; i++) {
            const circle = document.createElement('div');
            circle.className = 'circle';
            circle.style.cssText = `
                position: fixed;
                width: 8px;
                height: 8px;
                background: rgba(37, 99, 235, 0.3);
                border-radius: 50%;
                pointer-events: none;
                z-index: 99999;
                transition: transform 0.3s ease;
            `;
            document.body.appendChild(circle);
        }

        const circles = document.querySelectorAll('.circle');

        window.addEventListener('mousemove', function (e) {
            coords.x = e.clientX;
            coords.y = e.clientY;
        });

        function animateCircles() {
            let x = coords.x;
            let y = coords.y;

            circles.forEach(function (circle, index) {
                circle.style.left = x - 4 + 'px';
                circle.style.top = y - 4 + 'px';
                circle.style.transform = `scale(${(circles.length - index) / circles.length})`;

                const nextCircle = circles[index + 1] || circles[0];
                x += (nextCircle.offsetLeft - circle.offsetLeft) * 0.3;
                y += (nextCircle.offsetTop - circle.offsetTop) * 0.3;
            });

            requestAnimationFrame(animateCircles);
        }

        animateCircles();
    }
});

// ========================================
// Print Resume Functionality
// ========================================

function printResume() {
    window.print();
}

// ========================================
// Theme Toggle (Dark Default)
// ========================================

document.addEventListener('DOMContentLoaded', function () {
    const themeToggle = document.getElementById('theme-toggle');
    const savedTheme = localStorage.getItem('theme');

    const setTheme = (mode) => {
        const isLight = mode === 'light';
        document.body.classList.toggle('light-mode', isLight);

        if (themeToggle) {
            themeToggle.setAttribute('aria-pressed', String(isLight));
            themeToggle.setAttribute('aria-label', isLight ? 'Toggle dark mode' : 'Toggle light mode');
            const icon = themeToggle.querySelector('i');
            if (icon) {
                icon.className = isLight ? 'fas fa-sun' : 'fas fa-moon';
            }
        }
    };

    setTheme(savedTheme === 'light' ? 'light' : 'dark');

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const nextTheme = document.body.classList.contains('light-mode') ? 'dark' : 'light';
            localStorage.setItem('theme', nextTheme);
            setTheme(nextTheme);
        });
    }
});

// ========================================
// Magnetic Button Hover (Desktop Only)
// ========================================

document.addEventListener('DOMContentLoaded', function () {
    const buttons = document.querySelectorAll('.btn-primary, .btn-secondary, .btn-outline');
    const isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches && window.innerWidth > 768;

    if (!isDesktop || buttons.length === 0) return;

    buttons.forEach((btn) => {
        btn.style.transition = 'transform 0.25s ease, box-shadow 0.25s ease';
        btn.style.willChange = 'transform';

        btn.addEventListener('mousemove', (e) => {
            const rect = btn.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            const moveX = x * 0.12;
            const moveY = y * 0.12;

            btn.style.transform = `translate3d(${moveX}px, ${moveY}px, 0)`;
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'translate3d(0, 0, 0)';
        });
    });
});

// ========================================
// Spotlight Hover Effect (Desktop Only)
// ========================================

document.addEventListener('DOMContentLoaded', function () {
    const spotlightCards = document.querySelectorAll(
        '.expertise-card, .timeline-content, .education-item, .info-card'
    );
    const isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches && window.innerWidth > 768;

    if (!isDesktop || spotlightCards.length === 0) return;

    spotlightCards.forEach((card) => {
        card.classList.add('spotlight-card');

        card.addEventListener('mousemove', (event) => {
            const rect = card.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            card.style.setProperty('--spotlight-x', `${x}px`);
            card.style.setProperty('--spotlight-y', `${y}px`);
            card.classList.add('is-spotlight-active');
        });

        card.addEventListener('mouseleave', () => {
            card.classList.remove('is-spotlight-active');
        });
    });
});


// ========================================
// Animated Statistics Counter
// ========================================

document.addEventListener('DOMContentLoaded', function () {
    const statValues = document.querySelectorAll('.stat-value');

    if (statValues.length === 0) return;

    function animateCounter(element) {
        const target = parseInt(element.getAttribute('data-target'));
        const duration = 2000; // 2 seconds
        const increment = target / (duration / 16); // 60fps
        let current = 0;

        const updateCounter = () => {
            current += increment;
            if (current < target) {
                element.textContent = Math.floor(current);
                requestAnimationFrame(updateCounter);
            } else {
                element.textContent = target;
            }
        };

        updateCounter();
    }

    // Trigger animation on page load
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.classList.contains('counted')) {
                animateCounter(entry.target);
                entry.target.classList.add('counted');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    statValues.forEach(stat => observer.observe(stat));
});

// ========================================
// Animated Skill Bars
// ========================================

document.addEventListener('DOMContentLoaded', function () {
    const skillFills = document.querySelectorAll('.skill-fill');

    if (skillFills.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.classList.contains('animated')) {
                const level = entry.target.getAttribute('data-level');
                setTimeout(() => {
                    entry.target.style.width = level + '%';
                }, 100);
                entry.target.classList.add('animated');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.3 });

    skillFills.forEach(fill => observer.observe(fill));
});

// ========================================
// Swiper Slider Initialization
// ========================================

document.addEventListener('DOMContentLoaded', function () {
    if (typeof Swiper !== 'undefined') {
        const swiper = new Swiper('.swiper-container', {
            slidesPerView: 1,
            spaceBetween: 30,
            loop: true,
            autoplay: {
                delay: 5000,
                disableOnInteraction: false,
            },
            pagination: {
                el: '.swiper-pagination',
                clickable: true,
            },
            navigation: {
                nextEl: '.swiper-button-next',
                prevEl: '.swiper-button-prev',
            },
            effect: 'fade',
            fadeEffect: {
                crossFade: true
            }
        });
    }
});
