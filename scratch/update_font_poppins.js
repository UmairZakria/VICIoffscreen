const fs = require('fs');
const path = require('path');

const portalDir = path.resolve(__dirname, '..', '..', 'dnc-portal');

// 1. Update src/app/layout.js with Poppins from next/font/google
const layoutContent = `import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata = {
  title: "Auto Lookup — License & Quota Portal",
  description: "Compliance Lookup Authentication and Quota Management",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={\`\${poppins.variable} font-sans h-full antialiased\`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
`;

fs.writeFileSync(path.join(portalDir, 'src', 'app', 'layout.js'), layoutContent.trim() + '\n', 'utf8');
console.log('Updated layout.js with Poppins');

// 2. Update src/app/globals.css
const globalsContent = `@import "tailwindcss";

@theme inline {
  --font-sans: var(--font-poppins), 'Poppins', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

:root {
  --background: #ffffff;
  --foreground: #09090b;
}

body {
  background-color: #ffffff;
  color: #09090b;
  font-family: var(--font-poppins), 'Poppins', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

input, button, select, textarea {
  font-family: var(--font-poppins), 'Poppins', inherit;
}
`;

fs.writeFileSync(path.join(portalDir, 'src', 'app', 'globals.css'), globalsContent.trim() + '\n', 'utf8');
console.log('Updated globals.css with Poppins');
