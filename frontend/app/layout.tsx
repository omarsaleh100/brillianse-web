import './globals.css';
import { ReactNode } from 'react';
import Image from 'next/image';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Brillianse',
  description: 'Daily questions, daily groups.',
};

export const viewport = {
  themeColor: '#502754', 
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
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
      
      <body>
        <div className="app-content-wrapper">
          <header className="global-header">
            <div className="logo">
              <Image
                src="https://firebasestorage.googleapis.com/v0/b/brillianse-801f7.firebasestorage.app/o/logos%2FBrillianse%20(3)%20(1).png?alt=media&token=660301a4-d4b3-4200-b51d-ba3af4069cda"
                alt="Brillianse Logo"
                width={50}
                height={50}
                className="logo-img"
                priority
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