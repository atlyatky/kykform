export function BrandLogo({ height = 48 }: { height?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img 
        src="/logo.png" 
        alt="KYK Yapı Kimyasalları" 
        style={{ 
          height: height, 
          width: "auto",
          objectFit: "contain",
          display: "block"
        }} 
      />
    </div>
  );
}
