describe('Profile', () => {
  it('allows editing profile details', () => {
    cy.visit('/profile/edit');
    cy.get('[data-testid="display-name"]').clear().type('New Name');
    cy.get('[data-testid="save-button"]').click();
    cy.contains('Profile updated').should('be.visible');
  });
});
