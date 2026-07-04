// The sites to monitor, grouped by project. `wa` is the expected WhatsApp
// number (digits only) when the site is known to have a click-to-chat button;
// leave it null if the site has no WhatsApp button.
module.exports = [
  { project: 'Keya Homes', url: 'https://keyahomes.in',        wa: null },

  { project: 'ATL',    url: 'https://aroundthelife.co.in',      wa: null },
  { project: 'ATL',    url: 'https://aroundthelife.in',         wa: null },

  { project: 'TUF',    url: 'https://theurbanforest.co.in',     wa: null },
  { project: 'TUF',    url: 'https://theurbanforest.org',       wa: null },
  { project: 'TUF',    url: 'https://theurbanforest.ai',        wa: null },

  { project: 'TLT',    url: 'https://thelaketerraces.com',      wa: '919108506425' },
  { project: 'TLT',    url: 'https://thelaketerraces.in',       wa: '919108506425' },
  { project: 'TLT',    url: 'https://thelaketerraces.co.in',    wa: '919108506425' },

  { project: 'SPRING', url: 'https://keyaspring.com',           wa: '919591894433' },
  { project: 'SPRING', url: 'https://keyaspring.in',            wa: '919591894433' },
  { project: 'SPRING', url: 'https://keyaspring.co.in',         wa: '919591894433' },

  { project: 'LBL',    url: 'https://lifebythelake.in',         wa: null },
];
