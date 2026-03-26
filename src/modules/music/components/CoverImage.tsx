import { cn } from "@/lib/utils";

import { useCoverDataUrl } from "../hooks/useCoverDataUrl";



type Size = "sm" | "md" | "lg";



const sizeClass = {

  sm: "h-10 w-10 rounded-md",

  md: "h-14 w-14 rounded-lg",

  lg: "h-24 w-24 rounded-[18px]",

};



export function CoverImage({

  coverPath,

  dataUrl,

  size = "sm",

  className,

}: {

  coverPath: string | null;

  dataUrl?: string | null;

  size?: Size;

  className?: string;

}) {

  const pathDataUrl = useCoverDataUrl(dataUrl ? null : coverPath);

  const cls = sizeClass[size];



  const finalUrl = dataUrl ?? pathDataUrl;



  if (!coverPath && !finalUrl) {

    return (

      <div

        className={cn(

          "flex shrink-0 items-center justify-center bg-muted text-muted-foreground",

          size === "sm" ? "text-lg" : size === "md" ? "text-2xl" : "text-4xl",

          cls,

          className,

        )}

      >

        ♪

      </div>

    );

  }

  if (!finalUrl) {

    return (

      <div

        className={cn(

          "flex shrink-0 items-center justify-center bg-muted text-muted-foreground animate-pulse",

          size === "sm" ? "text-lg" : size === "md" ? "text-2xl" : "text-4xl",

          cls,

          className,

        )}

      >

        ♪

      </div>

    );

  }

  return (
    <img
      src={finalUrl}
      alt=""
      aria-hidden="true"
      loading="lazy"
      className={cn("shrink-0 bg-muted object-contain", cls, className)}
    />
  );

}

