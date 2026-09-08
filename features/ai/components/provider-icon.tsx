import type { FC } from "react";
import {
  ClaudeIcon,
  GoogleIcon,
  GrokIcon,
  OpenAIIcon,
  VercelIcon,
} from "@/components/ui/custom-icon";
import type { TextModelProviderId } from "../model.schema";

export function ProviderIcon({
  className,
  provider,
}: {
  provider: TextModelProviderId;
  className?: string;
}) {
  const Icon = getIconByProvider(provider);
  return <Icon className={className} />;
}

const getIconByProvider = (
  provider: TextModelProviderId,
): FC<{ className?: string }> => {
  switch (provider) {
    case "anthropic":
      return ClaudeIcon;
    case "google":
      return GoogleIcon;
    case "openai":
      return OpenAIIcon;
    case "vercel-ai-gateway":
      return VercelIcon;
    case "xai":
      return GrokIcon;
  }
};
