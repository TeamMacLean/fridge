<template>
  <nav class="navbar" role="navigation" aria-label="main navigation">
    <div class="navbar-brand">
      <nuxt-link to="/" class="navbar-item">
        <!--<img src="/fridge.png" width="16" height="28" style="margin-right:8px;">-->
        <b class="has-text-primary">Fridge</b>
      </nuxt-link>
      <a 
        role="button" 
        class="navbar-burger burger" 
        aria-label="menu" 
        aria-expanded="false" 
        type="button"
        data-target="navbarBasicExample"
      >
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
      </a>
    </div>

    <div id="navbarBasicExample" class="navbar-menu">
      <div class="navbar-start">
        <nuxt-link to="/stocks" class="navbar-item">
          Stocks
        </nuxt-link>
        <nuxt-link to="/masters" class="navbar-item">
          Masters
        </nuxt-link>
        <!-- <nuxt-link to="/frec" class="navbar-item">
          Frec
        </nuxt-link> -->
        <nuxt-link to="/search" class="navbar-item">
          Search
        </nuxt-link>
        <nuxt-link to="/ec-rc-names" class="navbar-item">
          EC/RC names
        </nuxt-link>
      </div>
      <div class="navbar-end">


        <div v-show="this.$auth.loggedIn" class="navbar-item has-dropdown is-hoverable">
          <a class="navbar-link">
            <font-awesome-icon :icon="['far', 'user-circle']" class="fa-2x" style="margin-right:8px;"/>
            {{this.$auth && this.$auth.user && this.$auth.user.name}}
          </a>


          <div class="navbar-dropdown">

            <a class="navbar-item" v-on:click="LogOut">
              Sign out
            </a>
          </div>
        </div>

        <div v-show="!this.$auth.loggedIn" class="navbar-item">
          <div class="buttons">
            <nuxt-link to="/signin" class="button is-outlined is-primary" type="button">
              Sign in
            </nuxt-link>
          </div>
        </div>
      </div>
    </div>
  </nav>

</template>

<script>


  export default {
    name: 'HeaderAfterLogin',
    methods: {
      async LogOut() {
        await this.$auth.logout()
        this.$router.push({
          path: '/'
        })
      }
    }
  }
</script>
<style>


  .navbar-menu > .navbar-item.is-active {
    background-color: #F7F7F7 !important;
  }
</style>
