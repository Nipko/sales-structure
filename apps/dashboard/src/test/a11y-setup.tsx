import * as React from "react";

/**
 * jsdom's gaps that React 19 and axe both walk into.
 *
 * Kept to the minimum: every shim here is a browser API jsdom does not
 * implement, never a stand-in for application behaviour.
 */

// React 19 refuses to run `act` outside an environment that claims to be one.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// axe reads computed styles through matchMedia while deciding what is visible.
if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as any;
}

// Components that observe their own size render nothing without this.
if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}

// A screen that scrolls a row into view must not throw in a test.
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
}

/**
 * Next's client hooks, which need a router this test has no reason to build.
 *
 * Navigation is not what an accessibility scan measures, and `<Link>` renders
 * an `<a href>` — the whole of what the accessibility tree sees. Registered
 * here rather than per spec so no screen accidentally scans without them and
 * no spec accidentally stubs something that matters.
 */
jest.mock("next/link", () => ({
    __esModule: true,
    default: ({ href, children, ...rest }: any) =>
        React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));

jest.mock("next/navigation", () => ({
    __esModule: true,
    useRouter: () => ({
        push: jest.fn(), replace: jest.fn(), back: jest.fn(),
        forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(),
    }),
    usePathname: () => "/admin",
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
}));

/** Props `motion` consumes itself and never forwards to the DOM. */
const MOTION_ONLY_PROPS = new Set([
    "initial", "animate", "exit", "transition", "whileHover", "whileTap",
    "whileInView", "whileFocus", "whileDrag", "variants", "layout", "layoutId",
    "viewport", "drag", "onAnimationComplete",
]);

/**
 * `motion/react` animates through the Web Animations API, which jsdom lacks.
 * The markup is identical either way, and markup is what is under test.
 */
jest.mock("motion/react", () => ({
    __esModule: true,
    motion: new Proxy({}, {
        get: (_target, tag: string) => ({ children, ...rest }: any) => {
            // Drop the animation props by name; anything else is a real DOM
            // attribute the component meant to set.
            const dom = Object.fromEntries(
                Object.entries(rest).filter(([prop]) => !MOTION_ONLY_PROPS.has(prop)),
            );
            return React.createElement(tag, dom, children);
        },
    }),
    AnimatePresence: ({ children }: any) => children,
}));
