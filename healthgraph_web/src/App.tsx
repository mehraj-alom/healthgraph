import { useCallback, useEffect, useState } from 'react';
import { LocaleProvider } from './i18n';
import SplashScreen from './Splash';
import Navbar from './Navbar';
import Hero from './Hero';
import Gallery from './Gallery';
import Capabilities from './Capabilities';
import Compare from './Compare';
import AppScreens from './AppScreens';
import Day from './Day';
import How from './How';
import Privacy from './Privacy';
import Videos from './Videos';
import Pricing from './Pricing';
import About from './About';
import Faq from './Faq';
import EarlyAccess from './EarlyAccess';
import Footer from './Footer';

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const done = useCallback(() => setShowSplash(false), []);

  // Deep links (site.tld/#pricing) need a re-scroll: the anchor id only exists
  // after React renders, which is after the browser's initial hash jump.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    let attempts = 0;
    const tryScroll = () => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
      else if (attempts++ < 20) setTimeout(tryScroll, 100);
    };
    tryScroll();
  }, []);

  return (
    <LocaleProvider>
      <div className="bg-stage min-h-full">
        {showSplash && <SplashScreen onComplete={done} />}
        <Navbar />
        <main>
          <Hero />
          <Gallery />
          <Capabilities />
          <Compare />
          <AppScreens />
          <Day />
          <How />
          <Privacy />
          <Videos />
          <Pricing />
          <About />
          <Faq />
          <EarlyAccess />
        </main>
        <Footer />
      </div>
    </LocaleProvider>
  );
}
