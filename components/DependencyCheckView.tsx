import { Text, View } from "nsh";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { ActionButton, Chip, Panel, SectionTitle } from "./ui";

export function DependencyCheckView() {
  const palette = store.palette;
  const status = store.dependencies;
  const missing = () => status()?.missingPackages ?? [];
  const allRequired = () => status()?.allRequiredInstalled ?? false;

  return (
    <View
      testID="dependency-check-view"
      style={{
        flex: 1,
        backgroundColor: palette().menu.background,
        padding: 24,
        gap: 16,
        alignItems: "center",
      }}
    >
      <View style={{ width: "100%", maxWidth: 680, gap: 4 }}>
        <Text style={{ color: palette().menu.text, fontSize: 24, fontWeight: "bold" }}>
          System Dependencies
        </Text>
        <Text style={{ color: palette().muted, fontSize: 13 }}>
          Omawarden needs these system packages before it can protect your vault.
        </Text>
      </View>

      <View style={{ width: "100%", maxWidth: 680, gap: 10 }}>
        <Each of={status()?.packages ?? []} key="index">
          {(pkg) => (
            <Panel testID={`dependency-${pkg().name}`}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <View style={{ gap: 2, flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ color: palette().popups.text, fontSize: 14, fontWeight: "bold" }}>
                      {pkg().name}
                    </Text>
                    <Chip
                      label={pkg().required ? "Required" : "Optional"}
                      color={pkg().required ? palette().info : palette().muted}
                    />
                  </View>
                  <Text style={{ color: palette().muted, fontSize: 12 }}>{pkg().description}</Text>
                  {pkg().version ? (
                    <Text style={{ color: palette().muted, fontSize: 11 }}>
                      Version {pkg().version}
                    </Text>
                  ) : null}
                </View>
                <View
                  style={{
                    backgroundColor: tint(
                      pkg().installed
                        ? palette().success
                        : pkg().required
                          ? palette().danger
                          : palette().warning,
                      palette().popups.background,
                      0.2,
                    ),
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                  }}
                >
                  <Text
                    style={{
                      color: pkg().installed
                        ? palette().success
                        : pkg().required
                          ? palette().danger
                          : palette().warning,
                      fontSize: 12,
                      fontWeight: "bold",
                    }}
                  >
                    {pkg().installed ? "Installed" : "Missing"}
                  </Text>
                </View>
              </View>
            </Panel>
          )}
        </Each>
      </View>

      <If when={status()}>
        {() => (
          <View style={{ width: "100%", maxWidth: 680, gap: 8 }}>
            <SectionTitle
              hint={
                allRequired()
                  ? "Every required package is available."
                  : "Install the missing packages to continue."
              }
            >
              {allRequired()
                ? "Ready to go"
                : `${missing().length} package${missing().length === 1 ? "" : "s"} missing`}
            </SectionTitle>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <ActionButton
                label="Install Missing Packages"
                testID="install-dependencies"
                tone="primary"
                disabled={missing().length === 0}
                onPress={store.installMissingDependencies}
              />
              <ActionButton
                label="Re-check"
                testID="recheck-dependencies"
                onPress={store.refreshDependencies}
              />
              <ActionButton
                label="Continue"
                testID="continue-dependencies"
                onPress={store.continueFromDependencies}
              />
            </View>
          </View>
        )}
      </If>
      <If when={!status()}>
        <Text style={{ color: palette().muted, fontSize: 13 }}>
          Checking system dependencies…
        </Text>
      </If>
    </View>
  );
}
