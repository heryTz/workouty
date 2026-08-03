// Root layout: wraps the whole app in PowerSyncProvider (so useAuth's provider calls — and
// PowerSync's own reactive queries — work anywhere below) and SafeAreaProvider (required by
// react-native-safe-area-context's SafeAreaView, which ui/Screen.tsx uses). No auth guard lives
// here — that's app/(app)/_layout.tsx's job, since it needs the PowerSyncProvider context
// (via useAuth) to already be available, which it isn't yet at this level.
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PowerSyncProvider } from "@/powersync/PowerSyncProvider";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PowerSyncProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </PowerSyncProvider>
    </SafeAreaProvider>
  );
}
