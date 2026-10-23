import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import App from '../renderer/app';

describe('App', () => {
  beforeAll(() => {
    // Stand-in for the bridge exposed by src/main/preload.ts.
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn(() => jest.fn()),
        sendMessage: jest.fn(),
        once: jest.fn(),
        invoke: jest.fn(),
      },
    };
  });

  it('should render', () => {
    expect(render(<App />)).toBeTruthy();
  });
});
