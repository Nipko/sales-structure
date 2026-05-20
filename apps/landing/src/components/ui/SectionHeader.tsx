"use client";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  tag?: "h1" | "h2" | "h3";
}

export function SectionHeader({ title, subtitle, tag: Tag = "h2" }: SectionHeaderProps) {
  return (
    <div className="text-center mb-12">
      <Tag className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 tracking-tight">
        {title}
      </Tag>
      {subtitle && (
        <p className="text-text-secondary max-w-2xl mx-auto">{subtitle}</p>
      )}
    </div>
  );
}
