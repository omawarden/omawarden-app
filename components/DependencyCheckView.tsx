import { Text, View } from "nsh";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { Icon } from "./Icon";
import { ActionButton, Chip } from "./ui";

export function DependencyCheckView() {
  const palette = store.palette;
  const status = store.dependencies;
  const packages = () => status()?.packages ?? [];
  const missing = () => status()?.missingPackages ?? [];

  // A package is green once it is there and red while it is missing; an
  // optional one that is absent is a warning rather than a blocker.
  const stateColor = (installed: boolean, required: boolean) =>
    installed ? palette().success : required ? palette().danger : palette().warning;

  const installLabel = () => {
    const names = missing();
    return names.length === 0
      ? "✓ All Dependencies Installed"
      : `⚡ Install Missing Packages (${names.join(", ")})`;
  };

  return (
    <View
      testID="dependency-check-view"
      style={{
        flex: 1,
        backgroundColor: palette().menu.background,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <View style={{ width: "100%", maxWidth: 680, gap: 16 }}>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Icon name="terminal" size={28} color={palette().menu.selectedText} />
            <Text
              style={{ color: palette().menu.text, fontSize: store.type()["6xl"], fontWeight: "bold" }}
            >
              System Dependencies Required
            </Text>
            <Chip label="Prerequisite Setup" color={palette().menu.selectedText} />
          </View>
          <Text style={{ color: palette().muted, fontSize: store.type().md }}>
            Omawarden needs native Arch / AUR packages for background encryption, system keyring
            session caching, and Wayland clipboard management.
          </Text>
        </View>

        <View style={{ gap: 10 }}>
          <Each of={packages()} key="index">
            {(pkg) => (
              <View
                testID={`dependency-${pkg().name}`}
                style={{
                  backgroundColor: tint(
                    stateColor(pkg().installed, pkg().required),
                    palette().menu.background,
                    0.12,
                  ),
                  borderColor: tint(
                    stateColor(pkg().installed, pkg().required),
                    palette().menu.background,
                    0.4,
                  ),
                  borderWidth: 1,
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: stateColor(pkg().installed, pkg().required),
                    }}
                  />
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Text
                        style={{
                          color: palette().menu.text,
                          fontSize: store.type().lg,
                          fontWeight: "bold",
                        }}
                      >
                        {pkg().name}
                      </Text>
                      <Chip
                        label={pkg().required ? "Required" : "Optional"}
                        color={pkg().required ? palette().info : palette().muted}
                      />
                      {pkg().version ? (
                        <Text
                          style={{
                            color: palette().success,
                            fontSize: store.type().sm,
                            fontWeight: "bold",
                          }}
                        >
                          v{pkg().version}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={{ color: palette().muted, fontSize: store.type().base }}>
                      {pkg().description}
                    </Text>
                  </View>
                  <View
                    style={{
                      backgroundColor: tint(
                        stateColor(pkg().installed, pkg().required),
                        palette().menu.background,
                        0.18,
                      ),
                      borderColor: stateColor(pkg().installed, pkg().required),
                      borderWidth: 1,
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 3,
                    }}
                  >
                    <Text
                      style={{
                        color: stateColor(pkg().installed, pkg().required),
                        fontSize: store.type().sm,
                        fontWeight: "bold",
                      }}
                    >
                      {pkg().installed ? "✓ Ready" : "✗ Missing"}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </Each>
        </View>

        <If when={status()}>
          {() => (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "stretch", gap: 12 }}>
                <ActionButton
                  label="↻ Recheck"
                  testID="recheck-dependencies"
                  onPress={store.refreshDependencies}
                />
                <View style={{ flex: 1 }}>
                  <ActionButton
                    label={installLabel()}
                    testID="install-dependencies"
                    tone="primary"
                    disabled={missing().length === 0}
                    onPress={store.installMissingDependencies}
                  />
                </View>
              </View>
              <Text style={{ color: palette().muted, fontSize: store.type().sm }}>
                Installs in an Omarchy floating terminal through paru / yay / pacman.
              </Text>
            </View>
          )}
        </If>
        <If when={!status()}>
          <Text style={{ color: palette().muted, fontSize: store.type().md }}>
            Checking system dependencies…
          </Text>
        </If>
      </View>
    </View>
  );
}
