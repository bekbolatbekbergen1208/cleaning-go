'use client';
import { useState } from 'react';
export function CopyCode({ code }: { code: string }) { const [copied,setCopied]=useState(false); return <button type="button" className="button" onClick={async()=>{await navigator.clipboard.writeText(code);setCopied(true);}}>{copied?'Скопировано':'Копировать код'}</button>; }
