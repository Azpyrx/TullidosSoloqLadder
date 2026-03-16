import { useState, useEffect, useCallback } from "react";
import { motion as _motion, AnimatePresence } from "motion/react";
import "./FooterCarousel.css";

const DDRAGON = "https://ddragon.leagueoflegends.com/cdn/img/champion/splash";

const SLIDES = [
  { key: "Nami",         name: "Nami" },
  { key: "Smolder",      name: "Smolder" },
  { key: "Draven",       name: "Draven" },
  { key: "KSante",       name: "K'Sante" },
  { key: "Fiddlesticks", name: "Fiddlesticks" },
  { key: "Vladimir",     name: "Vladimir" },
];

const INTERVAL_MS = 5000;

const variants = {
  enter: (dir) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0 }),
  center: { x: "0%", opacity: 1 },
  exit:  (dir) => ({ x: dir > 0 ? "-100%" : "100%", opacity: 0 }),
};

export default function FooterCarousel() {
  const [index, setIndex] = useState(0);
  const [dir, setDir]     = useState(1);

  const goTo = useCallback((i) => {
    setDir(i > index ? 1 : -1);
    setIndex(i);
  }, [index]);

  const next = useCallback(() => {
    setDir(1);
    setIndex((prev) => (prev + 1) % SLIDES.length);
  }, []);

  const prev = useCallback(() => {
    setDir(-1);
    setIndex((prev) => (prev - 1 + SLIDES.length) % SLIDES.length);
  }, []);

  useEffect(() => {
    const id = setInterval(next, INTERVAL_MS);
    return () => clearInterval(id);
  }, [next]);

  const slide = SLIDES[index];

  return (
    <footer className="fc">
      <div className="fc__track">
        <AnimatePresence custom={dir} initial={false}>
          <_motion.div
            key={slide.key}
            className="fc__slide"
            custom={dir}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
            style={{
              backgroundImage: `url(${DDRAGON}/${slide.key}_0.jpg)`,
            }}
          >
            <div className="fc__overlay" />
          </_motion.div>
        </AnimatePresence>
      </div>

      {/* Nav arrows */}
      <button className="fc__arrow fc__arrow--prev" onClick={prev} aria-label="Anterior">
        ‹
      </button>
      <button className="fc__arrow fc__arrow--next" onClick={next} aria-label="Siguiente">
        ›
      </button>

      {/* Dots */}
      <div className="fc__dots" role="tablist">
        {SLIDES.map((s, i) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={i === index}
            aria-label={s.name}
            className={`fc__dot${i === index ? " fc__dot--active" : ""}`}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </footer>
  );
}
