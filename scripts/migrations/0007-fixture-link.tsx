// Explicit harness seam: verify the real notification href, not Next SSR routing.
import type { AnchorHTMLAttributes } from 'react';
export default function Link(props:AnchorHTMLAttributes<HTMLAnchorElement>){return <a {...props} />;}
