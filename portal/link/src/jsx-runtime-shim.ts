// Automatic-JSX calls from shared repo components, mapped onto the global React's createElement.
const R = (window as unknown as { React: typeof import("react") }).React;
type Props = Record<string, unknown> | null;
export const Fragment = R.Fragment;
export function jsx(type: Parameters<typeof R.createElement>[0], props: Props, key?: string) {
  return R.createElement(type, key === undefined ? props : { ...props, key });
}
export const jsxs = jsx;
export const jsxDEV = jsx;
