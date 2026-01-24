// ========================================
// Smooth Scrolling & Navigation
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    // Mobile menu toggle
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('nav-menu');
    
    if (hamburger) {
        hamburger.addEventListener('click', function() {
            const isExpanded = navMenu.classList.toggle('active');
            
            // Update ARIA attribute for accessibility
            this.setAttribute('aria-expanded', isExpanded);
            
            // Animate hamburger
            const spans = this.querySelectorAll('span');
            spans[0].style.transform = isExpanded ? 'rotate(45deg) translate(5px, 5px)' : '';
            spans[1].style.opacity = isExpanded ? '0' : '1';
            spans[2].style.transform = isExpanded ? 'rotate(-45deg) translate(7px, -6px)' : '';
        });
    }
    
    // Close mobile menu when clicking on a link
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navMenu.classList.remove('active');
            
            // Reset ARIA attribute
            hamburger.setAttribute('aria-expanded', 'false');
            
            // Reset hamburger animation
            const spans = hamburger.querySelectorAll('span');
            spans[0].style.transform = '';
            spans[1].style.opacity = '1';
            spans[2].style.transform = '';
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

const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// Observe elements for animation
document.addEventListener('DOMContentLoaded', function() {
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

if (contactForm) {
    contactForm.addEventListener('submit', function(e) {
        const formData = new FormData(contactForm);
        
        // Show loading state
        const submitButton = contactForm.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.innerHTML;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
        submitButton.disabled = true;
        
        // Formspree will handle the actual submission
        // After submission, show success message
        setTimeout(() => {
            showNotification('Thank you! Your message has been sent successfully.', 'success');
            contactForm.reset();
            submitButton.innerHTML = originalButtonText;
            submitButton.disabled = false;
        }, 1000);
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

document.addEventListener('DOMContentLoaded', function() {
    const skillTags = document.querySelectorAll('.skill-tag');
    
    // Add stagger animation to skill tags
    skillTags.forEach((tag, index) => {
        tag.style.opacity = '0';
        tag.style.transform = 'scale(0.8)';
        tag.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        
        const skillObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    setTimeout(() => {
                        entry.target.style.opacity = '1';
                        entry.target.style.transform = 'scale(1)';
                    }, index * 30);
                    skillObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1 });
        
        skillObserver.observe(tag);
    });
});

// ========================================
// Typing Effect for Hero Title
// ========================================

document.addEventListener('DOMContentLoaded', function() {
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
    let current = 0;
    const increment = target / (duration / 16);
    const isNumber = !isNaN(target);
    
    const updateCounter = () => {
        current += increment;
        if (current < target) {
            element.textContent = isNumber ? Math.floor(current) : current.toFixed(1);
            requestAnimationFrame(updateCounter);
        } else {
            element.textContent = target + (element.textContent.includes('+') ? '+' : '');
        }
    };
    
    updateCounter();
}

document.addEventListener('DOMContentLoaded', function() {
    const stats = document.querySelectorAll('.stat h3');
    
    const statsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.classList.contains('counted')) {
                const text = entry.target.textContent;
                const number = parseFloat(text);
                const hasPlus = text.includes('+');
                const hasPercent = text.includes('%');
                
                entry.target.textContent = '0';
                animateCounter(entry.target, number, 2000);
                
                setTimeout(() => {
                    if (hasPlus) entry.target.textContent += '+';
                    if (hasPercent) entry.target.textContent += '%';
                }, 2000);
                
                entry.target.classList.add('counted');
                statsObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });
    
    stats.forEach(stat => statsObserver.observe(stat));
});

// ========================================
// Scroll to Top Button
// ========================================

document.addEventListener('DOMContentLoaded', function() {
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
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
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

document.addEventListener('DOMContentLoaded', function() {
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
        
        window.addEventListener('mousemove', function(e) {
            coords.x = e.clientX;
            coords.y = e.clientY;
        });
        
        function animateCircles() {
            let x = coords.x;
            let y = coords.y;
            
            circles.forEach(function(circle, index) {
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
// Dark Mode Toggle (Optional Enhancement)
// ========================================

// You can add this later if needed
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
}

// Load dark mode preference
document.addEventListener('DOMContentLoaded', function() {
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
    }
});