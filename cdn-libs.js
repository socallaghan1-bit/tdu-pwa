// On-demand CDNJS libraries, haptics policy, and lightweight celebrations.
// Libraries are only downloaded when a feature needs them; the service worker
// then serves them Cache First so repeat visits work on slow or offline connections.
(function () {
    const CDNJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/';

    const CDN_LIBS = {
        // cdnjs serves canvas-confetti's CommonJS source, so it is loaded with a temporary `module` shim.
        confetti: {
            scripts: [{ path: 'canvas-confetti/1.9.3/confetti.js', integrity: 'sha512-d+ZW87DH4Q33gcdLD4cdESUlAHokqxQ4dxprd5gvaerCF/Gkob/5FXOmtMEfbhna31eMTjH4TcLKLdIosh+Z3Q==', commonJs: true }],
            resolve: (exports) => {
                if (typeof exports === 'function') window.confetti = exports;
                return typeof window.confetti === 'function' ? window.confetti : null;
            }
        },
        leaflet: {
            styles: [{ path: 'leaflet/1.9.4/leaflet.css', integrity: 'sha512-Zcn6bjR/8RZbLEpLIeOwNtzREBAJnUKESxces60Mpoj+2okopSAcSUIUOseddDm0cxnGQzxIR7vJgsLZbdLE3w==' }],
            scripts: [{ path: 'leaflet/1.9.4/leaflet.js', integrity: 'sha512-BwHfrr4c9kmRkLw6iXFdzcdWV/PGkVgiIyIWLLlTSXzWQzxuSg4DiQUCpauz/EWjgk5TYQqX/kvn9pG1NpYfqg==' }],
            resolve: () => window.L || null
        },
        antPath: {
            deps: ['leaflet'],
            scripts: [{ path: 'leaflet-ant-path/1.3.0/leaflet-ant-path.js', integrity: 'sha512-/gkNQn+veOU6nWpevQbYDMuqu+DimUbAF8PBMun6ZOZW3PYEuQSfHcMiuE3rnxdKQ024veQv5ilZiwaLzGyrqw==' }],
            resolve: () => (window.L && window.L.polyline && typeof window.L.polyline.antPath === 'function' ? window.L.polyline.antPath : null)
        },
        lottie: {
            scripts: [{ path: 'lottie-web/5.12.2/lottie_light.min.js', integrity: 'sha512-Pe5arL9TnWlLgXT1VY0d50tfo6J9bh0qM7irYJuACQcGz7mbIahBXZmNeav+46mTQBtPY170Vi89KDa4kd4QVg==' }],
            resolve: () => window.lottie || window.bodymovin || null
        },
        gsap: {
            scripts: [
                { path: 'gsap/3.12.5/gsap.min.js', integrity: 'sha512-7eHRwcbYkK4d9g/6tD/mhkf++eoTHwpNM9woBxtPUBWm67zeAfFC+HrdoE2GanKeocly/VxeLvIqwvCdk7qScg==' },
                { path: 'gsap/3.12.5/ScrollTrigger.min.js', integrity: 'sha512-onMTRKJBKz8M1TnqqDuGBlowlH0ohFzMXYRNebz+yOcc5TQr/zAKsthzhuv0hiyUKEiQEQXEynnXCvNTOk50dg==' }
            ],
            resolve: () => {
                if (!window.gsap || !window.ScrollTrigger) return null;
                window.gsap.registerPlugin(window.ScrollTrigger);
                return window.gsap;
            }
        },
        chart: {
            scripts: [{ path: 'Chart.js/4.4.1/chart.umd.js', integrity: 'sha512-ZwR1/gSZM3ai6vCdI+LVF1zSq/5HznD3ZSTk7kajkaj4D292NLuduDCO1c/NT8Id+jE58KYLKT7hXnbtryGmMg==' }],
            resolve: () => window.Chart || null
        }
    };

    const libPromises = {};

    function appendStyle({ path, integrity }) {
        return new Promise((resolve, reject) => {
            const href = CDNJS_BASE + path;
            if (document.querySelector(`link[href="${href}"]`)) {
                resolve();
                return;
            }
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.integrity = integrity;
            link.crossOrigin = 'anonymous';
            link.referrerPolicy = 'no-referrer';
            link.onload = () => resolve();
            link.onerror = () => {
                link.remove();
                reject(new Error(`Failed to load ${href}`));
            };
            document.head.appendChild(link);
        });
    }

    function appendScript({ path, integrity, commonJs }) {
        return new Promise((resolve, reject) => {
            const src = CDNJS_BASE + path;
            const script = document.createElement('script');
            const hadModule = Object.prototype.hasOwnProperty.call(window, 'module');
            const previousModule = window.module;
            const shim = { exports: {} };

            const restoreModule = () => {
                if (!commonJs) return;
                if (hadModule) {
                    window.module = previousModule;
                } else {
                    delete window.module;
                }
            };

            if (commonJs) window.module = shim;

            script.src = src;
            script.async = false;
            script.integrity = integrity;
            script.crossOrigin = 'anonymous';
            script.referrerPolicy = 'no-referrer';
            script.onload = () => {
                restoreModule();
                resolve(commonJs ? shim.exports : undefined);
            };
            script.onerror = () => {
                restoreModule();
                script.remove();
                reject(new Error(`Failed to load ${src}`));
            };
            document.head.appendChild(script);
        });
    }

    function loadCdnLib(name) {
        const config = CDN_LIBS[name];
        if (!config) return Promise.reject(new Error(`Unknown CDN library: ${name}`));

        const alreadyAvailable = config.resolve();
        if (alreadyAvailable) return Promise.resolve(alreadyAvailable);
        if (libPromises[name]) return libPromises[name];

        libPromises[name] = (async () => {
            await Promise.all((config.deps || []).map(loadCdnLib));
            await Promise.all((config.styles || []).map(appendStyle));

            let exportsValue;
            for (const script of config.scripts || []) {
                exportsValue = await appendScript(script);
            }

            const lib = config.resolve(exportsValue);
            if (!lib) throw new Error(`CDN library ${name} did not initialise`);
            return lib;
        })().catch((error) => {
            delete libPromises[name];
            throw error;
        });

        return libPromises[name];
    }

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
        ]);
    }

    function prefersReducedMotion() {
        return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function prefersSavedData() {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        return Boolean(connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || '')));
    }

    // Haptics policy: never on scroll, hover, or minor clicks.
    // Only page/stage tab navigation (light pulse) and success milestones (double pulse).
    const HAPTIC_PATTERNS = {
        navigation: 12,
        success: [15, 50, 15]
    };

    function triggerHaptic(kind) {
        const pattern = HAPTIC_PATTERNS[kind];
        if (!pattern || typeof navigator.vibrate !== 'function') return false;
        if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
        try {
            return navigator.vibrate(pattern);
        } catch (error) {
            return false;
        }
    }

    const CONFETTI_COLORS = ['#003865', '#E35205', '#FFFFFF'];

    async function fireCalendarConfetti() {
        if (prefersReducedMotion()) return false;

        let confetti;
        try {
            // Skip the celebration if the library is slow to arrive; it stays cached for next time.
            confetti = await withTimeout(loadCdnLib('confetti'), 2500);
        } catch (error) {
            return false;
        }

        const shapes = ['circle'];
        if (typeof confetti.shapeFromText === 'function') {
            try {
                shapes.unshift(confetti.shapeFromText({ text: '🚲', scalar: 2.5 }));
            } catch (error) {
                // shapeFromText needs OffscreenCanvas; older browsers fall back to circles only.
            }
        }

        confetti({
            shapes,
            colors: CONFETTI_COLORS,
            particleCount: 45,
            spread: 80,
            origin: { y: 0.65 },
            ticks: 200,
            disableForReducedMotion: true
        });
        return true;
    }

    function celebrateSuccess({ confetti = false } = {}) {
        triggerHaptic('success');
        if (confetti) fireCalendarConfetti();
    }

    async function playLottieSuccess(container) {
        if (!container || prefersReducedMotion()) return false;
        try {
            const lottie = await withTimeout(loadCdnLib('lottie'), 4000);
            container.innerHTML = '';
            container.hidden = false;
            const animation = lottie.loadAnimation({
                container,
                renderer: 'svg',
                loop: false,
                autoplay: true,
                path: './animations/success-check.json'
            });
            animation.addEventListener('data_failed', () => {
                container.hidden = true;
            });
            return true;
        } catch (error) {
            container.hidden = true;
            return false;
        }
    }

    let revealTriggers = [];

    function revealCards(container, selector = '.event-card') {
        revealTriggers.forEach((trigger) => trigger.kill());
        revealTriggers = [];

        if (!container || prefersReducedMotion() || prefersSavedData() || !('IntersectionObserver' in window)) return;

        loadCdnLib('gsap').then((gsap) => {
            const cards = Array.from(container.querySelectorAll(selector));
            if (!cards.length || !container.isConnected) return;
            revealTriggers = window.ScrollTrigger.batch(cards, {
                start: 'top 95%',
                once: true,
                onEnter: (batch) => gsap.fromTo(batch, { autoAlpha: 0, y: 16 }, {
                    autoAlpha: 1,
                    y: 0,
                    duration: 0.35,
                    stagger: 0.05,
                    ease: 'power1.out',
                    overwrite: true,
                    clearProps: 'transform,opacity,visibility'
                })
            });
        }).catch(() => {
            // Cards are fully visible without GSAP, so a failed load needs no fallback.
        });
    }

    window.TDUCdn = {
        load: loadCdnLib,
        prefersReducedMotion,
        prefersSavedData
    };
    window.TDUHaptics = {
        navigation: () => triggerHaptic('navigation'),
        success: () => triggerHaptic('success')
    };
    window.TDUCelebrate = {
        success: celebrateSuccess,
        calendarConfetti: fireCalendarConfetti,
        lottieSuccess: playLottieSuccess
    };
    window.TDUMotion = { revealCards };
}());
