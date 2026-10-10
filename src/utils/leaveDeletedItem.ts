// =============================================================================
// leaveDeletedItem — where an edit form goes after DELETING the thing it edits.
// The form can be opened from a list OR from that item's own details page; going
// back one screen from the latter lands on a details page for something that no
// longer exists ("Account not found"). So: if the screen underneath is this
// item's details page, return past it too — like every other delete in the app.
// =============================================================================

interface NavLike {
  goBack: () => void;
  pop?: (count: number) => void;
  getState?: () => { routes: { name: string; params?: Record<string, unknown> }[] };
}

export function leaveDeletedItem(navigation: NavLike, detailRoute: string, idParam: string, id: string): void {
  const routes = navigation.getState?.().routes || [];
  const under = routes[routes.length - 2];
  if (navigation.pop && under?.name === detailRoute && under.params?.[idParam] === id) navigation.pop(2);
  else navigation.goBack();
}
