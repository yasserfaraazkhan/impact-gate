describe('Dashboard', () => {
  it('displays the dashboard overview', () => {
    cy.visit('/dashboard');
    cy.get('[data-testid="dashboard-overview"]').should('be.visible');
    cy.get('[data-testid="analytics-panel"]').should('exist');
  });
});
