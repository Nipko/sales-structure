import { useState } from "react";
import { interact, renderScreen } from "@/test/a11y";
import PasswordInput, { generatePassword, isPasswordValid } from "./PasswordInput";

function Harness() {
    const [password, setPassword] = useState("");
    return <PasswordInput id="password" value={password} onChange={setPassword} />;
}

describe("password generator", () => {
    it("uses browser cryptography, meets every rule, and does not copy the secret", async () => {
        const cryptoRandom = jest.spyOn(globalThis.crypto, "getRandomValues");
        const clipboardWrite = jest.fn();
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboardWrite } });
        const screen = await renderScreen(<Harness />);
        try {
            await interact(() => (screen.container.querySelector('button[aria-label="Generar contraseña"]') as HTMLButtonElement).click());
            const password = (screen.container.querySelector("input") as HTMLInputElement).value;
            expect(password).toHaveLength(16);
            expect(isPasswordValid(password)).toBe(true);
            expect(cryptoRandom).toHaveBeenCalled();
            expect(clipboardWrite).not.toHaveBeenCalled();
            expect(generatePassword()).toHaveLength(16);
        } finally {
            screen.unmount();
            cryptoRandom.mockRestore();
        }
    });
});
