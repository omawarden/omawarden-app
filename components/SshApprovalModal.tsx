import { Text, View } from "nsh";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { ActionButton, Chip, FieldRow, ModalShell, Panel, SectionTitle } from "./ui";

export function SshApprovalModal() {
  const palette = store.palette;
  const prompt = () => store.snapshot().sshPrompt;

  return (
    <If when={prompt()}>
      {(current) => (
        <ModalShell
          title={current().title}
          testID="ssh-approval-modal"
          subtitle="An application wants to use your SSH agent."
          width={560}
        >
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}
          >
            <Chip label="SSH Agent Request" color={palette().purple} />
            {current().forwarded ? (
              <Chip label="Forwarded" color={palette().warning} />
            ) : null}
            {current().remembered ? (
              <Chip label="Remembered for this session" color={palette().success} />
            ) : (
              <Chip label="Asked every time" color={palette().info} />
            )}
          </View>

          <Panel>
            <SectionTitle hint={current().action}>Request</SectionTitle>
            <FieldRow label="Key" value={current().keyName} />
            <FieldRow label="Fingerprint" value={current().fingerprint} mono />
            <FieldRow label="Client" value={current().client} />
            <FieldRow label="Command" value={current().command} mono />
          </Panel>

          {current().forwarded ? (
            <View
              testID="ssh-forwarded-warning"
              style={{
                backgroundColor: tint(
                  palette().warning,
                  palette().popups.background,
                  0.18,
                ),
                borderColor: palette().warning,
                borderWidth: 1,
                borderRadius: 8,
                padding: 10,
              }}
            >
              <Text style={{ color: palette().warning, fontSize: store.type().base }}>
                This request arrived over agent forwarding. Only approve it if you trust the
                remote host asking.
              </Text>
            </View>
          ) : null}

          <Text style={{ color: palette().muted, fontSize: store.type().base }}>
            {current().remaining > 0
              ? `${current().remaining} more request${
                  current().remaining === 1 ? "" : "s"
                } queued.`
              : "No other requests are waiting."}
          </Text>

          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <ActionButton
              label="Approve"
              testID="ssh-approve"
              tone="primary"
              onPress={() => store.resolveSshPrompt(current().id, true)}
            />
            <ActionButton
              label="Deny"
              testID="ssh-deny"
              tone="danger"
              onPress={() => store.resolveSshPrompt(current().id, false)}
            />
          </View>
        </ModalShell>
      )}
    </If>
  );
}
