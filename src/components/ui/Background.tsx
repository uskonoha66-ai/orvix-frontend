export default function Background() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden>
      {/* Base */}
      <div className="absolute inset-0 bg-bg-primary" />

      {/* Grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(92,206,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(92,206,255,1) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Blurred navy gradients */}
      <div
        className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full opacity-30"
        style={{
          background: 'radial-gradient(circle, #133c74 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />
      <div
        className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full opacity-20"
        style={{
          background: 'radial-gradient(circle, #0b1f3a 0%, transparent 70%)',
          filter: 'blur(60px)',
        }}
      />

      {/* Cyan radial glow — center */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full opacity-[0.04]"
        style={{
          background: 'radial-gradient(circle, #5cceff 0%, transparent 65%)',
        }}
      />

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 50%, rgba(5,11,20,0.6) 100%)',
        }}
      />
    </div>
  );
}
