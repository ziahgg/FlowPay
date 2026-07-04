import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { AuthService } from '../services/auth.service';
import { adminGuard, authGuard, guestGuard } from './auth.guard';

describe('auth guards', () => {
  let isAuthenticated: boolean;
  let isAdmin: boolean;
  let router: Router;

  beforeEach(() => {
    isAuthenticated = false;
    isAdmin = false;

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: () => isAuthenticated,
            isAdmin: () => isAdmin,
          },
        },
      ],
    });

    router = TestBed.inject(Router);
  });

  function runGuard(guard: CanActivateFn): boolean | UrlTree {
    return TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as boolean | UrlTree;
  }

  describe('authGuard', () => {
    it('allows navigation when the user is authenticated', () => {
      isAuthenticated = true;
      expect(runGuard(authGuard)).toBe(true);
    });

    it('redirects to /login when the user is not authenticated', () => {
      isAuthenticated = false;
      const result = runGuard(authGuard);
      expect(router.serializeUrl(result as UrlTree)).toBe('/login');
    });
  });

  describe('guestGuard', () => {
    it('allows navigation when the user is not authenticated', () => {
      isAuthenticated = false;
      expect(runGuard(guestGuard)).toBe(true);
    });

    it('redirects to /dashboard when the user is already authenticated', () => {
      isAuthenticated = true;
      const result = runGuard(guestGuard);
      expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
    });
  });

  describe('adminGuard', () => {
    it('allows navigation for admins', () => {
      isAdmin = true;
      expect(runGuard(adminGuard)).toBe(true);
    });

    it('redirects non-admins to /dashboard', () => {
      isAdmin = false;
      const result = runGuard(adminGuard);
      expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
    });
  });
});
