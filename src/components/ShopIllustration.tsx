'use client';

/**
 * Hand-drawn line-art illustration of the MRC storefront:
 * black sign band with MRC, scalloped awning, window with a barber chair,
 * arched window, door, and the barber pole — in the brand's black/cream/gold.
 */
export default function ShopIllustration() {
  const scallops = Array.from({ length: 15 }, () => 'q 10 12 20 0').join(' ');
  return (
    <div className="rounded-2xl overflow-hidden mb-4 mx-auto border border-gold/25" style={{ background: '#faf5e9', maxWidth: 280 }}>
      <svg viewBox="0 0 420 250" className="w-full h-auto block" role="img" aria-label="MRC Barbershop storefront">
        {/* ground */}
        <line x1="12" y1="226" x2="408" y2="226" stroke="#1a1a1a" strokeWidth="5" strokeLinecap="round" />

        {/* facade */}
        <rect x="44" y="116" width="292" height="110" fill="#fffdf7" stroke="#1a1a1a" strokeWidth="5" />

        {/* sign band */}
        <rect x="58" y="56" width="264" height="46" rx="15" fill="#1a1a1a" />
        <text
          x="190"
          y="89"
          textAnchor="middle"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontSize="30"
          fontWeight="800"
          letterSpacing="8"
          fill="#f3e6c3"
        >
          MRC
        </text>

        {/* awning */}
        <polygon points="28,102 352,102 338,134 42,134" fill="#f7ecd4" stroke="#1a1a1a" strokeWidth="5" strokeLinejoin="round" />
        <path d={`M 42 134 ${scallops}`} fill="none" stroke="#1a1a1a" strokeWidth="5" strokeLinecap="round" />

        {/* left window with barber chair */}
        <rect x="62" y="148" width="108" height="66" rx="12" fill="#f0e2c2" stroke="#1a1a1a" strokeWidth="5" />
        <line x1="116" y1="148" x2="116" y2="214" stroke="#1a1a1a" strokeWidth="4" />
        {/* chair */}
        <rect x="80" y="164" width="30" height="26" rx="9" fill="none" stroke="#1a1a1a" strokeWidth="4" />
        <line x1="74" y1="194" x2="122" y2="194" stroke="#1a1a1a" strokeWidth="4" strokeLinecap="round" />
        <line x1="98" y1="194" x2="98" y2="206" stroke="#1a1a1a" strokeWidth="4" strokeLinecap="round" />
        <line x1="88" y1="206" x2="108" y2="206" stroke="#1a1a1a" strokeWidth="4" strokeLinecap="round" />
        {/* glass reflection */}
        <path d="M 130 162 q 8 -7 16 0" fill="none" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round" />

        {/* arched middle window */}
        <path d="M 196 214 v -38 a 21 21 0 0 1 42 0 v 38 z" fill="#fffdf7" stroke="#1a1a1a" strokeWidth="5" />
        <rect x="210" y="196" width="14" height="18" fill="none" stroke="#1a1a1a" strokeWidth="3" />

        {/* door */}
        <rect x="266" y="148" width="54" height="66" rx="10" fill="#f0e2c2" stroke="#1a1a1a" strokeWidth="5" />
        <line x1="276" y1="166" x2="310" y2="166" stroke="#1a1a1a" strokeWidth="4" strokeLinecap="round" />
        <circle cx="308" cy="192" r="5" fill="#1a1a1a" />

        {/* barber pole */}
        <clipPath id="mrc-pole-clip">
          <rect x="358" y="110" width="24" height="92" rx="12" />
        </clipPath>
        <g clipPath="url(#mrc-pole-clip)">
          <rect x="358" y="110" width="24" height="92" fill="#ffffff" />
          <line x1="350" y1="126" x2="390" y2="152" stroke="#c9a227" strokeWidth="7" />
          <line x1="350" y1="152" x2="390" y2="178" stroke="#c9a227" strokeWidth="7" />
          <line x1="350" y1="178" x2="390" y2="204" stroke="#c9a227" strokeWidth="7" />
        </g>
        <rect x="358" y="110" width="24" height="92" rx="12" fill="none" stroke="#1a1a1a" strokeWidth="5" />
        <circle cx="370" cy="100" r="11" fill="#1a1a1a" />
        <circle cx="370" cy="212" r="11" fill="#1a1a1a" />
      </svg>
    </div>
  );
}
