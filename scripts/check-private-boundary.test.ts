import { assert, describe, it } from "@effect/vitest";

import { findPrivateMaterialPaths } from "./check-private-boundary.ts";

describe("fork-local private boundary", () => {
  it("rejects private material staged in the public source tree", () => {
    assert.deepStrictEqual(
      findPrivateMaterialPaths([
        "deploy/server.pem",
        "config/.env.production",
        "signing/app.mobileprovision",
        "keys/id_ed25519.backup",
        "config/.credentials.local",
      ]),
      [
        "deploy/server.pem",
        "config/.env.production",
        "signing/app.mobileprovision",
        "keys/id_ed25519.backup",
        "config/.credentials.local",
      ],
    );
  });

  it("allows public examples, public keys, and ordinary source files", () => {
    assert.deepStrictEqual(
      findPrivateMaterialPaths([
        ".env.example",
        "keys/id_ed25519.pub",
        "apps/server/src/http.ts",
        "docs/user/keybindings.md",
      ]),
      [],
    );
  });
});
