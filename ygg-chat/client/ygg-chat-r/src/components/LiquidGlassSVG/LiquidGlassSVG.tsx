import React from 'react'

/**
 * LiquidGlassSVG Component
 *
 * Provides SVG filter definitions for the liquid glass effect.
 * Should be rendered once at the root level of your app.
 *
 * The SVG contains:
 * - feTurbulence: Creates fractal noise for distortion
 * - feGaussianBlur: Blurs the noise
 * - feDisplacementMap: Displaces pixels based on the blurred noise
 *
 * Usage:
 * ```tsx
 * <LiquidGlassSVG />
 * ```
 *
 * Then use CSS:
 * ```css
 * .element {
 *   filter: url(#lg-glass-distortion);
 * }
 * ```
 */
export const LiquidGlassSVG: React.FC = () => {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='0'
      height='0'
      style={{ position: 'absolute', overflow: 'hidden', visibility: 'hidden' }}
    >
      <defs>
        {/* Subtle distortion - high frequency, low displacement - good for buttons */}
        <filter
          id='lg-glass-distortion-subtle'
          x='-20%'
          y='-20%'
          width='140%'
          height='140%'
          filterUnits='objectBoundingBox'
        >
          <feTurbulence type='fractalNoise' baseFrequency='0.02 0.02' numOctaves='1' seed='42' result='noise' />
          <feGaussianBlur in='noise' stdDeviation='1.5' result='blurred' />
          <feDisplacementMap in='SourceGraphic' in2='blurred' scale='15' xChannelSelector='R' yChannelSelector='G' />
        </filter>

        {/* Medium distortion - balanced - good for cards */}
        <filter
          id='lg-glass-distortion-medium'
          x='-20%'
          y='-20%'
          width='140%'
          height='140%'
          filterUnits='objectBoundingBox'
        >
          <feTurbulence type='fractalNoise' baseFrequency='0.008 0.008' numOctaves='2' seed='92' result='noise' />
          <feGaussianBlur in='noise' stdDeviation='2' result='blurred' />
          <feDisplacementMap in='SourceGraphic' in2='blurred' scale='50' xChannelSelector='R' yChannelSelector='G' />
        </filter>

        {/* Intense distortion - low frequency, high displacement - featured sections */}
        <filter
          id='lg-glass-distortion-intense'
          x='-30%'
          y='-30%'
          width='160%'
          height='160%'
          filterUnits='objectBoundingBox'
        >
          <feTurbulence type='fractalNoise' baseFrequency='0.005 0.005' numOctaves='3' seed='123' result='noise' />
          <feGaussianBlur in='noise' stdDeviation='3' result='blurred' />
          <feDisplacementMap in='SourceGraphic' in2='blurred' scale='100' xChannelSelector='R' yChannelSelector='G' />
        </filter>

        {/* Extreme distortion - very low frequency, maximum displacement */}
        <filter
          id='lg-glass-distortion-extreme'
          x='-40%'
          y='-40%'
          width='180%'
          height='180%'
          filterUnits='objectBoundingBox'
        >
          <feTurbulence type='fractalNoise' baseFrequency='0.003 0.003' numOctaves='4' seed='999' result='noise' />
          <feGaussianBlur in='noise' stdDeviation='4' result='blurred' />
          <feDisplacementMap in='SourceGraphic' in2='blurred' scale='150' xChannelSelector='R' yChannelSelector='G' />
        </filter>

        {/* Default/fallback filter - same as medium */}
        <filter
          id='lg-glass-distortion'
          x='-20%'
          y='-20%'
          width='140%'
          height='140%'
          filterUnits='objectBoundingBox'
        >
          <feTurbulence type='fractalNoise' baseFrequency='0.008 0.008' numOctaves='2' seed='92' result='noise' />
          <feGaussianBlur in='noise' stdDeviation='2' result='blurred' />
          <feDisplacementMap in='SourceGraphic' in2='blurred' scale='50' xChannelSelector='R' yChannelSelector='G' />
        </filter>

        {/* Button-specific liquid distortion - optimized for small elements */}
        <filter
          id='liquid-button-distortion'
          x='-20%'
          y='-20%'
          width='140%'
          height='140%'
          filterUnits='objectBoundingBox'
        >
          <feTurbulence type='fractalNoise' baseFrequency='0.015 0.015' numOctaves='2' seed='77' result='noise' />
          <feGaussianBlur in='noise' stdDeviation='1.5' result='blurred' />
          <feDisplacementMap in='SourceGraphic' in2='blurred' scale='25' xChannelSelector='R' yChannelSelector='G' />
        </filter>
      </defs>
    </svg>
  )
}

export default LiquidGlassSVG
