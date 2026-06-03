import React from 'react';
import { render } from '@testing-library/react-native';
import { ListSkeleton, RowSkeleton, Skeleton } from '../Skeleton';

describe('Skeleton', () => {
    it('renderiza sin romper', () => {
        expect(() => render(<Skeleton height={12} />)).not.toThrow();
        expect(() => render(<RowSkeleton />)).not.toThrow();
        expect(() => render(<ListSkeleton rows={3} />)).not.toThrow();
    });
});
