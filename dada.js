// V-DADA Loader Script
// Automatically loads JSON data from v-dada attribute and makes it available as 'dada' variable

(function() {
  'use strict';
  
  async function loadDadaData() {
    const elements = document.querySelectorAll('[v-dada]');
    
    for (const element of elements) {
      const url = element.getAttribute('v-dada');
      if (!url) continue;
      
      try {
        console.log('Loading data from:', url);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Data loaded:', data);
        
        // Wait for PetiteVue to be available
        const waitForPetiteVue = () => {
          return new Promise((resolve) => {
            if (window.PetiteVue) {
              resolve(window.PetiteVue);
            } else {
              const checkInterval = setInterval(() => {
                if (window.PetiteVue) {
                  clearInterval(checkInterval);
                  resolve(window.PetiteVue);
                }
              }, 50);
            }
          });
        };
        
        const PetiteVue = await waitForPetiteVue();
        console.log('PetiteVue available, creating app');
        
        // Save data globally as 'dada'
        window.dada = data;
        
        // Create PetiteVue instance with dada data
        PetiteVue.createApp({
          dada: data
        }).mount(element);
        
        console.log('App mounted successfully');
        
      } catch (error) {
        console.error('Failed to load data from', url, ':', error);
      }
    }
  }
  
  // Load when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadDadaData);
  } else {
    loadDadaData();
  }
})();