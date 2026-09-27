'use client';

import { useEffect } from 'react';

/** Progressive enhancement: content stays visible without JavaScript. */
export function HomeMotion() {
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animations = new Set<Animation>();
    let observer: IntersectionObserver | undefined;

    function stop() {
      observer?.disconnect();
      animations.forEach((animation) => animation.cancel());
      animations.clear();
    }

    function start() {
      stop();
      if (preference.matches || !('IntersectionObserver' in window)) return;
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer?.unobserve(entry.target);
          const index = Number((entry.target as HTMLElement).dataset.motionIndex ?? 0);
          const animation = entry.target.animate(
            [{ opacity: 0.35, transform: 'translateY(22px)' }, { opacity: 1, transform: 'translateY(0)' }],
            { duration: 600, delay: (index % 3) * 80, easing: 'cubic-bezier(.22,1,.36,1)' },
          );
          animations.add(animation);
          animation.onfinish = () => animations.delete(animation);
        });
      }, { threshold: 0.12 });
      document.querySelectorAll('.public-home .section-heading, .public-home .service-tile, .public-home .easy-section > div')
        .forEach((element, index) => {
          (element as HTMLElement).dataset.motionIndex = String(index);
          observer?.observe(element);
        });
    }

    start();
    preference.addEventListener('change', start);
    return () => { stop(); preference.removeEventListener('change', start); };
  }, []);

  return null;
}
