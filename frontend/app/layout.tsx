'use client';

import './globals.css';
import { ReactNode, useState, useEffect } from 'react'; // <-- MODIFIED
import Image from 'next/image';
import { Metadata } from 'next';

const metadata: Metadata = { // <-- UPDATE METADATA OBJECT
  title: 'Brillianse',
  description: 'Daily questions, daily groups.',
  
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Set a timer for 1 second
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1000); // 1000ms = 1 second

    // Clean up the timer if the component unmounts
    return () => clearTimeout(timer);
  }, []); // The empty array ensures this runs only once on mount
  return (
    <html lang="en">
      <head>
        {/* We add the 'Inter' font link here */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <link 
          rel="icon" 
          href="https://firebasestorage.googleapis.com/v0/b/brillianse-801f7.firebasestorage.app/o/logos%2FGroup%2012.png?alt=media&token=75e6d28c-5ab1-4189-bfce-9b6ed7fedaf0" 
          type="image/png" 
        />
      </head>
      
      {/* --- BODY MODIFIED --- */}
      <body>
        
        {/* --- 1. LOADING OVERLAY --- */}
        {/* This div will be on top, spin, and fade out */}
        <div className={`app-loading-overlay ${isLoading ? 'visible' : 'hidden'}`}>
          <div className="logo loading-logo">
            <Image
              src="https://firebasestorage.googleapis.com/v0/b/brillianse-801f7.firebasestorage.app/o/logos%2FBrillianse%20(3)%20(1).png?alt=media&token=660301a4-d4b3-4200-b51d-ba3af4069cda"
              alt="Brillianse Logo"
              width={50}
              height={50}
              className="logo-img"
              priority 
            />
          </div>
        </div>

        {/* --- 2. MAIN CONTENT --- */}
        {/* This div will be underneath and will fade in */}
        <div className={`app-content-wrapper ${isLoading ? 'hidden' : 'visible'}`}>
          <header className="global-header">
            <div className="logo">
              <Image
                src="https://firebasestorage.googleapis.com/v0/b/brillianse-801f7.firebasestorage.app/o/logos%2FBrillianse%20(3)%20(1).png?alt=media&token=660301a4-d4b3-4200-b51d-ba3af4069cda"
                alt="Brillianse Logo"
                width={50}
                height={50}
                className="logo-img"
                priority // Load the logo first
              />
            </div>
          </header>
          <main>
            {children}
          </main>
        </div>
        
      </body>
    </html>
  );
}