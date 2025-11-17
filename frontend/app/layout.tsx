import './globals.css';
import { ReactNode } from 'react';
import Image from 'next/image';
import { Metadata } from 'next'; // <-- IMPORT METADATA

export const metadata: Metadata = { // <-- UPDATE METADATA OBJECT
  title: 'Brillianse',
  description: 'Daily questions, daily groups.',
  icons: {
    icon: [
      {
        url: 'https://firebasestorage.googleapis.com/v0/b/brillianse-801f7.firebasestorage.app/o/logos%2FGroup%2012.png?alt=media&token=75e6d28c-5ab1-4189-bfce-9b6ed7fedaf0',
        href: 'https://firebasestorage.googleapis.com/v0/b/brillianse-801f7.firebasestorage.app/o/logos%2FGroup%2012.png?alt=media&token=75e6d28c-5ab1-4189-bfce-9b6ed7fedaf0',
        type: 'image/png',
      },
    ],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
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

        {/* --- THE MANUAL FAVICON LINK IS NOW REMOVED --- */}
        {/* Next.js will auto-generate the link from the metadata object */}
      </head>
      <body>
        <header className="global-header">
          <div className="logo">
            {/* --- THIS IS THE CHANGE --- */}
            <Image
              src="https://firebasestorage.googleapis.com/v0/b/brillianse-801f7.firebasestorage.app/o/logos%2FBrillianse%20(3)%20(1).png?alt=media&token=660301a4-d4b3-4200-b51d-ba3af4069cda"
              alt="Brillianse Logo"
              width={50}
              height={50}
              className="logo-img"
              priority // Load the logo first
            />
            {/* ------------------------- */}
          </div>
        </header>
        <main>
          {children}
        </main>
      </body>
    </html>
  );
}