import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LawmindMainView } from "../lawmind-main-view";

export type ShellNavigationContextValue = {
  mainView: LawmindMainView;
  matterCockpitOpen: boolean;
  settingsOpen: boolean;
};

export type ChatSessionContextValue = {
  selectedAssistantId: string;
  activeChatSessionId: string | undefined;
};

export type AutomationsNavContextValue = {
  selectedAutomationId: string | null;
  setSelectedAutomationId: (id: string | null) => void;
  automationsListVersion: number;
  bumpAutomationsListVersion: () => void;
};

const ShellNavigationContext = createContext<ShellNavigationContextValue | null>(null);
const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);
const AutomationsNavContext = createContext<AutomationsNavContextValue | null>(null);

function AutomationsNavProvider(props: { mainView: LawmindMainView; children: ReactNode }) {
  const { mainView, children } = props;
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const [automationsListVersion, setAutomationsListVersion] = useState(0);

  useEffect(() => {
    if (mainView !== "automations") {
      setSelectedAutomationId(null);
    }
  }, [mainView]);

  const bumpAutomationsListVersion = useCallback(() => {
    setAutomationsListVersion((v) => v + 1);
  }, []);

  const value = useMemo(
    (): AutomationsNavContextValue => ({
      selectedAutomationId,
      setSelectedAutomationId,
      automationsListVersion,
      bumpAutomationsListVersion,
    }),
    [selectedAutomationId, automationsListVersion, bumpAutomationsListVersion],
  );

  return <AutomationsNavContext.Provider value={value}>{children}</AutomationsNavContext.Provider>;
}

export function LawmindShellProviders(props: {
  navigation: ShellNavigationContextValue;
  chatSession: ChatSessionContextValue;
  children: ReactNode;
}) {
  const { navigation, chatSession, children } = props;
  return (
    <ShellNavigationContext.Provider value={navigation}>
      <ChatSessionContext.Provider value={chatSession}>
        <AutomationsNavProvider mainView={navigation.mainView}>{children}</AutomationsNavProvider>
      </ChatSessionContext.Provider>
    </ShellNavigationContext.Provider>
  );
}

export function useLawmindShellNavigationContext(): ShellNavigationContextValue {
  return (
    useContext(ShellNavigationContext) ?? {
      mainView: "workspace",
      matterCockpitOpen: false,
      settingsOpen: false,
    }
  );
}

export function useLawmindChatSessionContext(): ChatSessionContextValue {
  return (
    useContext(ChatSessionContext) ?? {
      selectedAssistantId: "",
      activeChatSessionId: undefined,
    }
  );
}

export function useLawmindAutomationsNavContext(): AutomationsNavContextValue {
  return (
    useContext(AutomationsNavContext) ?? {
      selectedAutomationId: null,
      setSelectedAutomationId: () => {},
      automationsListVersion: 0,
      bumpAutomationsListVersion: () => {},
    }
  );
}
