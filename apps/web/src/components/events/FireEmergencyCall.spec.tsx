import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FireEmergencyCall } from './FireEmergencyCall';

describe('fire emergency call action', () => {
  it('offers an explicit native-dialer link rather than making an automatic call', () => {
    const html = renderToStaticMarkup(<FireEmergencyCall />);
    expect(html).toContain('href="tel:114"');
    expect(html).toContain('Gọi 114');
    expect(html).toContain('Cảnh sát PCCC');
  });
});
