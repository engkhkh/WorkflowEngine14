import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { DOC_TYPES } from './erp.config';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isLoggedIn()) return true;
  router.navigate(['/login']);
  return false;
};

/** Where to send someone who opened a screen they have no privilege for. */
function fallback(auth: AuthService, router: Router) {
  return router.parseUrl(auth.can('dashboard.view') ? '/tabs/home' : '/tabs/documents');
}

/** Route needs ANY of the listed privileges, e.g. permGuard('admin.users', 'org.manage'). */
export const permGuard = (...perms: string[]): CanActivateFn => () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isLoggedIn()) return router.parseUrl('/login');
  return auth.canAny(...perms) ? true : fallback(auth, router);
};

/** /new/:docType needs "<module of that document>.create". */
export const createGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const dt = DOC_TYPES.find(d => d.key === route.paramMap.get('docType'));
  return !dt || auth.can(dt.module + '.create') ? true : fallback(auth, router);
};
